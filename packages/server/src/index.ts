import { createSSIAgent } from '@tfm/shared'
import { BlockchainService } from './blockchain'
import express, { Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as jwt from 'jsonwebtoken'
import * as bcrypt from 'bcryptjs'


const JWT_SECRET = 'secret-key-for-authentication'      // Change this in production. Use env vars or secure vaults.
const USER_FILE = path.join(__dirname, '../users.json')

interface User {
    username: string;
    passwordHash: string;
    role: 'admin' | 'auditor';
}

function getUsers(): User[] {
    if (!fs.existsSync(USER_FILE)) return [];
    return JSON.parse(fs.readFileSync(USER_FILE, 'utf-8'))
}

async function initializeSystem(){
    const users = getUsers();
    if (users.length > 0) return;

    console.log('🔐 No se encontraron usuarios. Creando usuario admin por defecto...');
    const adminUser: User = {
        username: 'admin',
        passwordHash: await bcrypt.hash('admin', 10),
        role: 'admin'
    }
    users.push(adminUser);
    fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2))
}

const authenticateToken = (req: any, res: Response, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
}


const requireAdmin = (req: any, res: Response, next: any) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado: Solo administradores' });
    next();
}


async function main() {
  console.log('🖥️  Iniciando Servidor de IA (Verifier + Data Ingestion)...')
  await initializeSystem() // Aseguramos que el sistema tenga al menos un usuario admin

  const SERVER_SECRET_KEY = '55555555cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8555'
  const DB_FILE = 'server-database.sqlite'
  const PORT = 3000

  const droneDirectory = new Map<string, string>()
  const DATASET_FILE = path.join(__dirname, '../drones-dataset.csv')

  // Inicializar Dataset CSV si no existe
  if (!fs.existsSync(DATASET_FILE)) {
    fs.writeFileSync(DATASET_FILE, 'timestamp,did,battery,altitude,temperature\n')
    console.log('📁 Nuevo dataset creado: drones-dataset.csv')
  }

  // --- 1. INICIALIZACIÓN BLOCKCHAIN ---
  const bcService = new BlockchainService()
  try {
      await bcService.connect()
      console.log('✅ Conexión establecida con Hyperledger Fabric')
  } catch (error) {
      console.error('⚠️  ADVERTENCIA: No se pudo conectar a Blockchain. El servidor funcionará en modo local, pero fallarán las escrituras en Ledger.')
  }

  try {
    // --- 2. INICIALIZACIÓN AGENTE SSI ---
    const agent = await createSSIAgent(DB_FILE, SERVER_SECRET_KEY)
    
    const existingDids = await agent.didManagerFind()
    let serverIdentifier = existingDids.length > 0 
      ? existingDids[0] 
      : await agent.didManagerCreate({ alias: 'AI-Server-01', provider: 'did:key' })
    
    console.log(`✅ Identidad del Servidor (DID): ${serverIdentifier.did}`)
    console.log('---------------------------------------------------------')

    // --- 3. CONFIGURACIÓN EXPRESS ---
    const app = express()
    
    // Middleware para parsear JSON (CRUCIAL para /register y /revoke)
    app.use(express.json())
    
    // Middleware para archivos estáticos (Dashboard)
    app.use(express.static(path.join(__dirname, '../public')))

    app.post('/auth/login', async (req: Request, res: Response) => {
        const { username, password } = req.body;
        const users = getUsers();
        const user = users.find(u => u.username === username);
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Credenciales mal' });
        
        const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, role: user.role, username: user.username });
    });

    app.post('/auth/register', authenticateToken, requireAdmin, async (req: any, res: Response) => {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });
        
        const users = getUsers();
        if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Existe usuario' });

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, passwordHash: hashedPassword, role: role === 'admin' ? 'admin' : 'auditor' });
        fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
        res.json({ message: 'Usuario creado' });
    });

    // --- ENDPOINT DE MENSAJERÍA DIDCommV2 (Recepción de Telemetría) ---
    app.post('/messaging', express.text({ type: '*/*' }), async (req: Request, res: Response) => {
      try {
        console.log('📩 Recibiendo mensaje DIDComm...')

        // 1. DESEMPAQUETAR MENSAJE
        const unpacked = await agent.unpackDIDCommMessage({
          message: req.body,
        })

        const message = unpacked.message;
        const droneDid = message.from;
        const body = message.body;
        const credentials = body.verifiableCredential;

        if (!credentials || credentials.length === 0) {
           console.warn('⚠️  Mensaje recibido sin credenciales');
           res.status(401).send('No credentials provided');
           return;
        }

        const targetCredential = credentials[0];

        // 2. VERIFICAR FIRMA CRIPTOGRÁFICA (Veramo)
        const verificationResult = await agent.verifyCredential({
            credential: targetCredential
        })

        if (verificationResult.verified === true) {
            
            // =================================================================
            // 2.1. NUEVA VERIFICACIÓN: CONSULTAR REVOCACIÓN EN BLOCKCHAIN
            // =================================================================
            const credentialId = verificationResult.verifiableCredential.id; 

            if (!credentialId) {
              console.error(`⚠️ Error: La credencial recibida NO tiene ID. No se puede verificar revocación.`);
                // Opcional: Rechazar la petición si es estricto
                // return res.status(400).json({ error: 'invalid_credential_structure' });
                
                // O si prefieres continuar (pero sin verificar revocación):
                console.log('   - Saltando verificación de revocación (ID desconocido).');
            } else {

              console.log(`🔐 Credencial verificada. ID: ${credentialId}`);
              
              try {
                  // Consultamos al Smart Contract si este ID está en la lista negra
                  const isRevoked = await bcService.isRevoked(credentialId);

                  if (isRevoked) {
                      console.error(`⛔ ALERTA DE SEGURIDAD: Dron con credencial REVOCADA intentó enviar datos.`);
                      console.error(`   - DID Dron: ${droneDid}`);
                      console.error(`   - Credencial ID: ${credentialId}`);
                      
                      // Rechazamos la petición inmediatamente
                      res.status(403).json({ 
                          error: 'credential_revoked', 
                          message: 'Su licencia de vuelo ha sido revocada por la autoridad.' 
                      });
                      return; // Cortamos la ejecución aquí
                  }
              } catch (revocationError) {
                  console.warn('⚠️  No se pudo verificar el estado de revocación (Blockchain offline?). Se asume válido por defecto.', revocationError);
              }

              console.log('   - ✅ Licencia válida y ACTIVA (No revocada).');

              // 3. EXTRACCIÓN DE DATOS DE TELEMETRÍA
              const battery = body.battery ?? 0;
              const altitude = body.altitude ?? 0;
              const temperature = body.temperature ?? body.temp ?? 0;
              // Usamos la fecha del dron o la actual si no viene
              const timestamp = body.timestamp || new Date().toISOString();

              // 4. GUARDADO EN CSV (LOG LOCAL)
              const csvLine = `${timestamp},${droneDid},${battery},${altitude},${temperature}\n`
              fs.appendFileSync(DATASET_FILE, csvLine)

              // 5. GUARDADO EN BLOCKCHAIN (PERSISTENCIA)
              try {
                  // Generamos un ID único para el registro de vuelo
                  const recordId = `vuelo-${Date.now()}`;
                  
                  console.log(`💾 Escribiendo en Ledger... [ID: ${recordId}]`)
                  
                  await bcService.createTelemetry(
                      recordId,
                      timestamp,      // Pasamos la fecha como string (DETERMINISMO)
                      droneDid || 'unknown_did',
                      battery,
                      altitude,
                      temperature
                  )
                  console.log(`🔗 Dato inmutable registrado exitosamente.`)

              } catch (bcError) {
                  console.error('❌ Error escribiendo en Blockchain:', bcError)
              }
              
              // Respuesta de éxito al Dron
              res.json({ status: 'success', message: 'Data verified and saved on-chain' })
            }

        } else {
            console.warn(`⚠️  Firma de credencial inválida para el DID: ${droneDid}`);
            res.status(403).send('Invalid Credential Signature');
        }

      } catch (error) {
        console.error('❌ Error procesando mensaje DIDComm:', error);
        res.status(500).send('Internal Server Error');
      }
    })
  

    // --- DIRECTORIO DE DRONES (Opcional, para búsquedas directas) ---
    app.post('/directory', authenticateToken, (req: Request, res: Response) => {
      const { action, did, endpoint } = req.body;
      if (action === 'register') {
        droneDirectory.set(did, endpoint);
        console.log(`📇 Registro Directorio Local: ${did} -> ${endpoint}`);
        return res.status(200).json({ status: 'registered' });
      }
      if (action === 'lookup') {
        const targetEndpoint = droneDirectory.get(did);
        return targetEndpoint 
          ? res.status(200).json({ endpoint: targetEndpoint }) 
          : res.status(404).json({ error: 'No encontrado' });
      }
      res.status(400).send('Acción no válida');
    });

    // --- OBTENER HISTORIAL DE VUELO (Lectura Blockchain) ---
    app.get('/history/:did', authenticateToken, async (req: Request, res: Response) => {
        try {
            const didParam = req.params.did as string;
            // Decodificamos el DID por si viene con caracteres especiales de URL
            const cleanDid = decodeURIComponent(didParam);
            
            // Usamos la función corregida que filtra por docType='telemetry'
            const data = await bcService.getTelemetryByDid(cleanDid);
            
            // data viene como string JSON desde Fabric, lo parseamos para enviarlo como objeto JSON limpio
            res.json(JSON.parse(data));
        } catch (error) {
            console.error('❌ Error obteniendo historial:', error);
            res.status(500).send({ error: 'Error obteniendo datos de Blockchain' });
        }
    });

    // --- OBTENER CENSO DE DRONES (Para el desplegable del Dashboard) ---
    app.get('/drones', authenticateToken, async (req: Request, res: Response) => {
        try {
            // Usamos la función getAllDrones (que llama a GetAllDronesInLedger en el contrato)
            const drones = await bcService.getAllDrones();
            res.json(drones);
        } catch (error) {
            console.error('❌ Error obteniendo lista de drones:', error);
            res.status(500).send({ error: 'Error de Blockchain' });
        }
    });

    // --- REGISTRAR NUEVO DRON (Desde el botón "Registrar" del Dashboard) ---
    app.post('/register', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
        try {
            const { droneDid, name } = req.body;

            if (!droneDid || !name) {
                return res.status(400).json({ error: 'Faltan datos (DID o Nombre)' });
            }

            await bcService.registerDrone(droneDid, name);
            res.json({ status: 'success', message: `Dron ${name} registrado correctamente` });

        } catch (error) {
            console.error('❌ Error registrando dron:', error);
            res.status(500).json({ error: 'Error interno de Blockchain al registrar' });
        }
    });

    // --- REVOCAR CREDENCIAL (Zona de Peligro) ---
    app.post('/revoke', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
        try {
            const { credentialId } = req.body;
            if (!credentialId) {
                return res.status(400).json({ error: 'Falta el ID de la credencial' });
            }

            await bcService.revokeCredential(credentialId);
            console.log(`⛔ Credencial revocada vía API: ${credentialId}`);
            
            res.json({ status: 'success', message: 'Credencial revocada correctamente' });
        } catch (e) {
            console.error('❌ Error revocando credencial:', e);
            res.status(500).json({ error: 'Error al revocar en Blockchain' });
        }
    });

    // GET /revocations - Devuelve la lista negra
    app.get('/revocations', authenticateToken, async (req: Request, res: Response) => {
        try {
            const list = await bcService.getRevocationList();
            res.json(list);
        } catch (error) {
            console.error('❌ Error obteniendo revocaciones:', error);
            res.status(500).json({ error: 'Error Blockchain' });
        }
    });

    // --- HTTPS SERVER ---
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, '../certs/server.key')),
      cert: fs.readFileSync(path.join(__dirname, '../certs/server.cert'))
    };

    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`\n🔒 SERVIDOR SEGURO (HTTPS) ACTIVO EN PUERTO ${PORT}`);
      console.log(`   ➜ Dashboard: https://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error)
  }
}

main()