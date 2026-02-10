import { createSSIAgent } from '@tfm/shared'
import { BlockchainService } from './blockchain'
import express, { Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'

async function main() {
  console.log('🖥️  Iniciando Servidor de IA (Verifier + Data Ingestion)...')

  const SERVER_SECRET_KEY = '55555555cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8555'
  const DB_FILE = 'server-database.sqlite'
  const PORT = 3000

  const droneDirectory = new Map<string, string>()
  const DATASET_FILE = path.join(__dirname, '../drones-dataset.csv')

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
      console.error('⚠️  ADVERTENCIA: No se pudo conectar a Blockchain.')
  }

  try {
    const agent = await createSSIAgent(DB_FILE, SERVER_SECRET_KEY)
    
    const existingDids = await agent.didManagerFind()
    let serverIdentifier = existingDids.length > 0 
      ? existingDids[0] 
      : await agent.didManagerCreate({ alias: 'AI-Server-01', provider: 'did:key' })
    
    console.log(`✅ Identidad del Servidor: ${serverIdentifier.did}`)
    console.log('---------------------------------------------------------')

    const app = express()
    app.use(express.json())
    app.use(express.static(path.join(__dirname, '../public')))

    // --- ENDPOINT DE MENSAJERÍA DIDCommV2 ---
    app.post('/messaging', express.text({ type: '*/*' }), async (req: Request, res: Response) => {
      try {
        console.log('📩 Recibiendo sobre DIDCommV2...')

        // console.log('--- MENSAJE RECIBIDO (RAW) ---')
        // console.log(req.body)
        // console.log('-------------------------------')

        // 1. DESEMPAQUETAR
        const unpacked = await agent.unpackDIDCommMessage({
          message: req.body,
        })

        const droneDid = unpacked.message.from
        const body = unpacked.message.body
        const credentials = body.verifiableCredential

        if (!credentials || credentials.length === 0) {
           res.status(401).send('No credentials')
           return
        }

        // 2. VERIFICAR LICENCIA
        const verificationResult = await agent.verifyCredential({
            credential: credentials[0]
        })

        if (verificationResult.verified === true) {
            // Extraemos con valores por defecto para evitar 'undefined'
            const battery = body.battery ?? 0;
            const altitude = body.altitude ?? 0;
            const temperature = body.temperature ?? body.temp ?? 0; // Aceptamos 'temperature' o 'temp'
            const timestamp = body.timestamp ?? new Date().toISOString();
            const ts = timestamp || new Date().toISOString()

            // A. GUARDADO EN CSV
            const csvLine = `${ts},${droneDid},${battery},${altitude},${temperature || 0}\n`
            fs.appendFileSync(DATASET_FILE, csvLine)
            console.log(`✅ [DIDComm] Verificado de: ${droneDid}`)

            // B. GUARDADO EN BLOCKCHAIN
            try {
                const txId = `tx-${Date.now()}`
                console.log(`Log: Guardando en Blockchain con ID ${txId}`)
                console.log(`Datos: Batería ${battery}%, Altitud ${altitude}m, Temp ${temperature}°C`)
                console.log(`Timestamp: ${ts}`)
                console.log(`DID: ${droneDid}`)
                await bcService.createTelemetry(
                    txId,
                    timestamp,
                    droneDid || 'unknown_did',
                    battery,        // Int (ej: 98)
                    altitude,       // Float (ej: 25.5) - ¡Ya funciona!
                    temperature            // Float (ej: 22.4)
                )
            } catch (bcError) {
                console.error('❌ Error en Blockchain')
            }
            
            res.json({ status: 'decrypted_verified_and_saved' })
        } else {
            res.status(403).send('Invalid Credential')
        }

      } catch (error) {
        console.error('❌ Error DIDComm:', error)
        res.status(500).send('Error decrypting message')
      }
    })

    // --- DIRECTORIO DE DRONES ---
    app.post('/directory', express.json(), (req: Request, res: Response) => {
      const { action, did, endpoint } = req.body;
      if (action === 'register') {
        droneDirectory.set(did, endpoint);
        console.log(`📇 Registro: ${did} -> ${endpoint}`);
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

    // --- HISTORIAL (CORREGIDO) ---
    app.get('/history/:did', async (req: Request, res: Response) => {
        try {
            // CORRECCIÓN: Forzamos el tipo a string con 'as string'
            const didParam = req.params.did as string;
            const data = await bcService.getTelemetryByDid(decodeURIComponent(didParam));
            res.json(JSON.parse(data));
        } catch (error) {
            res.status(500).send({ error: 'Error obteniendo datos' });
        }
    });
    // Devuelve la lista de nombres y DIDs registrados
    app.get('/drones', async (req: Request, res: Response) => {
        try {
            const drones = await bcService.getAllDrones();
            res.json(drones);
        } catch (error) {
            console.error('❌ Error obteniendo drones:', error);
            res.status(500).send({ error: 'Error de Blockchain' });
        }
    });
    app.post('/register', async (req, res) => {
        try {
            const { droneDid, name } = req.body;

            if (!droneDid || !name) {
                return res.status(400).json({ error: 'Faltan datos (DID o Nombre)' });
            }

            await bcService.registerDrone(droneDid, name);
            res.json({ status: 'success', message: `Dron ${name} registrado` });

        } catch (error) {
            console.error('❌ Error registrando dron:', error);
            res.status(500).json({ error: 'Error interno de Blockchain' });
        }
    });

    // --- HTTPS SERVER ---
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, '../certs/server.key')),
      cert: fs.readFileSync(path.join(__dirname, '../certs/server.cert'))
    };

    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`\n🔒 SERVIDOR SEGURO (HTTPS) ACTIVO EN PUERTO ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error fatal:', error)
  }
}

main()