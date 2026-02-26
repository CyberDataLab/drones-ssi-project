import { createSSIAgent } from '@tfm/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import express from 'express'
import * as readline from 'readline'
import * as os from 'os'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // This is needed to allow self-signed certificates in development. DO NOT USE IN PRODUCTION.

async function main() {
  console.log('🚁 Starting Drone Agent...')

  const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'
  const DB_FILE = 'drone-database.sqlite'
  const CONFIG_FILE = path.join(__dirname, '../drone-config.json')

  if (!fs.existsSync(CONFIG_FILE)) {
      console.error('❌ ERROR: Configuration file not found. Please run the setup script first.')
      process.exit(1)
  }

  function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const info of iface) {
          if (info.family === 'IPv4' && !info.internal) {
            addresses.push(info.address);
          }
        }
      }
    }
    return addresses;
  }
  
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  const SERVER_DID = config.serverDid
  const SERVER_IP = '192.168.56.109'
  const MY_IP = getLocalIP()[0]
  console.log(`📡 Detected local IP: ${MY_IP}`)

  const P2P_PORT = parseInt(process.env.P2P_PORT || '40000')

  try {
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY)
    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, 
    });

    const identifiers = await agent.didManagerFind()
    if (identifiers.length === 0) {
        console.error('⛔ ERROR: The drone has no DID.')
        process.exit(1)
    }

    const droneDID = identifiers[0].did
    const credentials = await agent.dataStoreORMGetVerifiableCredentials()
    const license = credentials.find((c: any) => c.verifiableCredential.credentialSubject.type === 'DroneLicense')

    if (!license) {
        console.error('⛔ ALERTA: The drone has no valid flight license.')
        return
    }

    const myLicenseJwt = license.verifiableCredential.proof.jwt
    console.log(`✅ Verified identity: ${droneDID}`)
    console.log(`🔑 License JWT: ${myLicenseJwt}`)

    async function registerInDirectory() {
      const myEndpoint = `http://${MY_IP}:${P2P_PORT}/messaging`;
      try {
          const response = await fetch(`https://${SERVER_IP}:3000/directory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'register', did: droneDID, endpoint: myEndpoint }),
            agent: httpsAgent
          } as any);

          if (response.ok)
            console.log(`✅ Registered in directory: ${myEndpoint}`);
          else{
            console.error('❌ Failed to register in directory. Is the server running? ', response.statusText);
          }
      } catch (e) {
          console.error('❌ Error registering in directory: ', e);
      }
    }
    async function sendToPeer(peerDid: string, peerUrl: string) {
      try {
        const message = {
          id: 'p2p-' + Date.now(),
          type: 'https://didcomm.org/drone-p2p/1.0/share-metrics',
          from: droneDID,
          to: [peerDid],
          body: { battery: 85, altitude: 20, licenseJwt: myLicenseJwt }, // Static values for demo purposes
        }

        const packed = await agent.packDIDCommMessage({ packing: 'authcrypt', message })
        const messageBody = typeof packed.message === 'string' ? packed.message : JSON.stringify(packed.message)

        console.log(`📡 Connecting with peer in: ${peerUrl}...`);
        const res = await fetch(peerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: messageBody,
        })

        if (res.ok) console.log(`✅ P2P message sent to ${peerDid}`);
      } catch (e) {
        console.error(`❌ Error in P2P connection to ${peerUrl}. Is the other drone powered on?`);
      }
    }

    async function talkToPeer(targetDid: string) {
      console.log(`🔍 Searching drone: ${targetDid}...`);
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
            console.error('❌ Target drone not found in directory. Make sure the other drone is powered on and registered.');
          }
      } catch (e) {
          console.error('❌ Error contacting the server directory: ', e);
      }
    }

    const app = express()
    app.use(express.text({ type: '*/*' }))

    app.post('/messaging', async (req, res) => {
      try {
        const unpacked = await agent.unpackDIDCommMessage({ message: req.body })
        const senderDid = unpacked.message.from
        const { battery, licenseJwt } = unpacked.message.body

        const verification = await agent.verifyCredential({ credential: licenseJwt })

        if (verification.verified && verification.verifiableCredential.credentialSubject.id === senderDid) {
            console.log(`\n📥 [P2P Received]: Message verified from: ${senderDid}`);
            console.log(`📊 Data: Battery ${battery}%`);
            res.status(200).send('OK')
        } else {
            res.status(403).send('Valid License required to communicate')
        }
      } catch (e) {
        res.status(500).send('Error unpack')
      }
    })

    app.listen(P2P_PORT, '0.0.0.0', async () => {
      console.log(`📡 P2P Server available on port ${P2P_PORT}`)
      await registerInDirectory()

      const metricsData = {
        id: 'msg-' + Date.now(),
        type: 'https://didcomm.org/drone-metrics/1.0/update',
        from: droneDID,
        to: [SERVER_DID],
        body: { 
          battery: 98, 
          altitude: 120.5,
          temperature: 35.2,
          timestamp : new Date().toISOString(),
          verifiableCredential: [myLicenseJwt] 
        },
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
        rl.question('\n📝 Paste the DID of another drone to communicate (or “exit”): ', async (input) => {
          input = input.trim();
          if (input === 'exit') process.exit(0);
          if (input.startsWith('did:')) await talkToPeer(input);
          menu();
        });
      };
      menu();
    })

  } catch (error) {
    console.error('❌ Error: ', error)
  }
}

main()