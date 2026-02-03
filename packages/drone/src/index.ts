import { createSSIAgent } from '@tfm/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import express from 'express'
import * as readline from 'readline' // Importación necesaria para el teclado

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  console.log('🚁 Iniciando Agente Dron (Modo Autónomo)...')

  const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'
  const DB_FILE = 'drone-database.sqlite'
  const CONFIG_FILE = path.join(__dirname, '../drone-config.json')

  // 1. CARGAR CONFIGURACIÓN
  if (!fs.existsSync(CONFIG_FILE)) {
      console.error('❌ ERROR FATAL: Archivo de configuración no encontrado.')
      process.exit(1)
  }
  
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  const SERVER_DID = config.serverDid
  const SERVER_IP = '192.168.56.109'
  const P2P_PORT = parseInt(process.env.P2P_PORT || '40000')

  try {
    // 2. INICIALIZACIÓN DE AGENTES (Criptografía y Red)
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY)
    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, 
    });

    // 3. VERIFICACIÓN DE IDENTIDAD Y LICENCIA
    const identifiers = await agent.didManagerFind()
    if (identifiers.length === 0) {
        console.error('⛔ ERROR: El dron no tiene identidad.')
        process.exit(1)
    }

    const droneDID = identifiers[0].did
    const credentials = await agent.dataStoreORMGetVerifiableCredentials()
    const license = credentials.find((c: any) => c.verifiableCredential.credentialSubject.type === 'DroneLicense')

    if (!license) {
        console.error('⛔ ALERTA: Dron sin licencia de vuelo válida.')
        return
    }

    const myLicenseJwt = license.verifiableCredential.proof.jwt
    console.log(`✅ Identidad Verificada: ${droneDID}`)

    // 4. FUNCIONES DE COMUNICACIÓN

    // Registro en el directorio del servidor (Usamos 127.0.0.1 para evitar ECONNREFUSED)
    async function registerInDirectory() {
      const myEndpoint = `http://${SERVER_IP}:${P2P_PORT}/messaging`; 
      try {
          await fetch(`https://${SERVER_IP}:3000/directory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'register', did: droneDID, endpoint: myEndpoint }),
            agent: httpsAgent
          } as any);
          console.log(`✅ Registrado en directorio: ${myEndpoint}`);
      } catch (e) {
          console.error('❌ No se pudo registrar en el servidor central.');
      }
    }

    // Envío directo a otro dron
    async function sendToPeer(peerDid: string, peerUrl: string) {
      try {
        const message = {
          id: 'p2p-' + Date.now(),
          type: 'https://didcomm.org/drone-p2p/1.0/share-metrics',
          from: droneDID,
          to: [peerDid],
          body: { battery: 85, altitude: 20, licenseJwt: myLicenseJwt },
        }

        const packed = await agent.packDIDCommMessage({ packing: 'authcrypt', message })
        const messageBody = typeof packed.message === 'string' ? packed.message : JSON.stringify(packed.message)

        console.log(`📡 Conectando con par en: ${peerUrl}...`);
        const res = await fetch(peerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: messageBody,
        })

        if (res.ok) console.log(`✅ Mensaje P2P enviado con éxito a ${peerDid}`);
      } catch (e) {
        console.error(`❌ Fallo en conexión P2P hacia ${peerUrl}. ¿Está el otro dron encendido?`);
      }
    }

    // Buscador de drones
    async function talkToPeer(targetDid: string) {
      console.log(`🔍 Buscando dirección de: ${targetDid}...`);
      try {
          const response = await fetch(`https://${SERVER_IP}:3000/directory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'lookup', did: targetDid }),
            agent: httpsAgent
          } as any);

          if (response.ok) {
            const { endpoint } = await response.json();
            await sendToPeer(targetDid, endpoint);
          } else {
            console.error('❌ Dron objetivo no registrado en el servidor.');
          }
      } catch (e) {
          console.error('❌ Error contactando con el directorio del servidor.');
      }
    }

    // 5. SERVIDOR DE ESCUCHA (Express)
    const app = express()
    app.use(express.text({ type: '*/*' }))

    app.post('/messaging', async (req, res) => {
      try {
        const unpacked = await agent.unpackDIDCommMessage({ message: req.body })
        const senderDid = unpacked.message.from
        const { battery, licenseJwt } = unpacked.message.body

        const verification = await agent.verifyCredential({ credential: licenseJwt })

        if (verification.verified && verification.verifiableCredential.credentialSubject.id === senderDid) {
            console.log(`\n📥 [P2P RECIBIDO]: Mensaje verificado de ${senderDid}`);
            console.log(`📊 Datos: Batería al ${battery}%`);
            res.status(200).send('OK')
        } else {
            res.status(403).send('Licencia inválida')
        }
      } catch (e) {
        res.status(500).send('Error unpack')
      }
    })

    // 6. ARRANQUE Y TECLADO
    app.listen(P2P_PORT, '0.0.0.0', async () => {
      console.log(`📡 Servidor P2P activo en puerto ${P2P_PORT}`)
      await registerInDirectory()

      // Telemetría inicial al servidor
      const metricsData = {
        id: 'msg-' + Date.now(),
        type: 'https://didcomm.org/drone-metrics/1.0/update',
        from: droneDID,
        to: [SERVER_DID],
        body: { battery: 98, verifiableCredential: [myLicenseJwt] },
      }
      const packedServer = await agent.packDIDCommMessage({ packing: 'authcrypt', message: metricsData })

      await fetch(`https://${SERVER_IP}:3000/messaging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: packedServer.message,
        agent: httpsAgent
      } as any)

      // Interfaz de comandos
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const menu = () => {
        rl.question('\n📝 Pega el DID de otro dron para comunicarte (o "exit"): ', async (input) => {
          input = input.trim();
          if (input === 'exit') process.exit(0);
          if (input.startsWith('did:')) await talkToPeer(input);
          menu();
        });
      };
      menu();
    })

  } catch (error) {
    console.error('❌ Error Operativo:', error)
  }
}

main()