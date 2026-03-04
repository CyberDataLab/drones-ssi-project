import { createSSIAgent } from '@tfm/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import express from 'express'
import * as readline from 'readline'
import * as os from 'os'
// import { BbsBlsSignatureProof2020, deriveProof, verifyProof } from '@mattrglobal/jsonld-signatures-bbs'
// @ts-ignore
import { extendContextLoader, purposes } from 'jsonld-signatures'


process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // This is needed to allow self-signed certificates in development. DO NOT USE IN PRODUCTION.
let isConnectedToServer = false;
let telemetryBuffer: any[] = [];
let retryTelemetryInterval = 5000;
let retryRegisterInterval = 5000;




const contextCache = new Map();

const customLoader = async (url: string) => {

  if (contextCache.has(url)) {
    return contextCache.get(url);
  } 

  const response = await fetch(url, {
    headers: { 'Accept': 'application/ld+json, application/json' },
        redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} en ${url}`);
  }

  const result = { contextUrl: null, documentUrl: url, document: await response.json() };
  contextCache.set(url, result);


  return result;
}

const documentLoader = extendContextLoader(customLoader);







async function main() {
  console.log('🚁 Starting Drone Agent...')

  const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'
  const DB_FILE = 'drone-database.sqlite'
  const CONFIG_FILE = path.join(__dirname, '../drone-config.json')
  const LOCAL_LICENSE_FILE = path.join(__dirname, '../license/drone-license.json')

  if (!fs.existsSync(CONFIG_FILE)) {
      console.error('❌ ERROR: Configuration file not found. Please run the setup script first.')
      process.exit(1)
  }

  if (!fs.existsSync(LOCAL_LICENSE_FILE)) {
    console.error('❌ ERROR: License file not found. Please run the setup script first.')
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

    const myBbsCredential = JSON.parse(fs.readFileSync(LOCAL_LICENSE_FILE, 'utf-8'))
    console.log(`📄 Loaded local license credential for DID: ${droneDID}`)
    console.log(`📄 BBS+ credential loaded`)

    async function registerInDirectory() {
      const myEndpoint = `http://${MY_IP}:${P2P_PORT}/messaging`;
      try {
          const response = await fetch(`https://${SERVER_IP}:3000/directory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'register', did: droneDID, endpoint: myEndpoint }),
            agent: httpsAgent
          } as any);

          if (response.ok) {
            console.log(`✅ Registered in directory: ${myEndpoint}`);
            isConnectedToServer = true;
          } else{
            throw new Error('Failed to register in directory: ' + response.statusText);
          }
      } catch (e) {
          isConnectedToServer = false;
          console.log(`\n❌ Error registering in directory, will retry in ${retryRegisterInterval} ms...`);
          setTimeout(registerInDirectory, retryRegisterInterval)
      }
    }
    // async function sendToPeer(peerDid: string, peerUrl: string) {
    //   try {
    //     const message = {
    //       id: 'p2p-' + Date.now(),
    //       type: 'https://didcomm.org/drone-p2p/1.0/share-metrics',
    //       from: droneDID,
    //       to: [peerDid],
    //       body: { battery: 85, altitude: 20, licenseJwt: myLicenseJwt }, // Static values for demo purposes
    //     }

    //     const packed = await agent.packDIDCommMessage({ packing: 'authcrypt', message })
    //     const messageBody = typeof packed.message === 'string' ? packed.message : JSON.stringify(packed.message)

    //     console.log(`📡 Connecting with peer in: ${peerUrl}...`);
    //     const res = await fetch(peerUrl, {
    //       method: 'POST',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: messageBody,
    //     })

    //     if (res.ok) console.log(`✅ P2P message sent to ${peerDid}`);
    //   } catch (e) {
    //     console.error(`❌ Error in P2P connection to ${peerUrl}. Is the other drone powered on?`);
    //   }
    // }

    // async function talkToPeer(targetDid: string) {
    //   console.log(`🔍 Searching drone: ${targetDid}...`);
    //   try {
    //       const response = await fetch(`https://${SERVER_IP}:3000/directory`, {
    //         method: 'POST',
    //         headers: { 'Content-Type': 'application/json' },
    //         body: JSON.stringify({ action: 'lookup', did: targetDid }),
    //         agent: httpsAgent
    //       } as any);

    //       if (response.ok) {
    //         const { endpoint } = await response.json();
    //         await sendToPeer(targetDid, endpoint);
    //       } else {
    //         console.error('❌ Target drone not found in directory. Make sure the other drone is powered on and registered.');
    //       }
    //   } catch (e) {
    //       console.error('❌ Error contacting the server directory: ', e);
    //   }
    // }

    let simBattery = 100;
    let simAltitude = 50;
    let isSendingTelemetry = false;

    function startTelemetryLoop() {
      setInterval(async () => {
        simBattery = Math.max(0, simBattery - 0.2); 
        simAltitude = simAltitude + (Math.random() * 4 - 2); 

        const metric = { 
            battery: parseFloat(simBattery.toFixed(1)), 
            altitude: parseFloat(simAltitude.toFixed(1)),
            temperature: parseFloat((35 + Math.random()).toFixed(1)),
            timestamp : new Date().toISOString(),
            verifiableCredential: [myBbsCredential] 
        };

        telemetryBuffer.push(metric);

        if (!isConnectedToServer) {
            console.log(`\n⚠️ Not connected to server, telemetry buffered: ${telemetryBuffer.length} items`);
            return; 
        }

        if (!isConnectedToServer || telemetryBuffer.length === 0 || isSendingTelemetry) {
            return; 
        }
        isSendingTelemetry = true;

        try {
            if (telemetryBuffer.length > 1) {
                console.log(`📤 Sending ${telemetryBuffer.length} telemetry items`);
            }
            while (telemetryBuffer.length > 0) {
                const item = telemetryBuffer[0]; 

                const message = {
                    id: 'msg-' + Date.now() + Math.random(),
                    type: 'https://didcomm.org/drone-metrics/1.0/update',
                    from: droneDID,
                    to: [SERVER_DID],
                    body: item
                };
                const packedServer = await agent.packDIDCommMessage({ packing: 'authcrypt', message });
                
                console.log(`📡 Sending telemetry to server: Altitude ${item.altitude}m, Battery ${item.battery}%...`);
                const response = await fetch(`https://${SERVER_IP}:3000/messaging`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: packedServer.message,
                    agent: httpsAgent
                } as any);

                if (response.ok) {
                    telemetryBuffer.shift(); 
                    console.log(`✅ Telemetry sent (Alt:${item.altitude}m, Bat:${item.battery}%). Remaining buffer: ${telemetryBuffer.length}`);
                } else {
                    throw new Error('Failed to send telemetry: ' + response.statusText);
                }
            }
        } catch (e) {
            console.error(`❌ Error sending telemetry, Server disconnected. Will retry in next cycle: ${e}`);
            isConnectedToServer = false;

            console.log(`📦 Telemetry buffer size: ${telemetryBuffer.length}`);

            registerInDirectory();
        } finally {
            isSendingTelemetry = false;
        }
      }, retryTelemetryInterval);
    }

    // const app = express()
    // app.use(express.text({ type: '*/*' }))

    // app.post('/messaging', async (req, res) => {
    //   try {
    //     const unpacked = await agent.unpackDIDCommMessage({ message: req.body })
    //     const senderDid = unpacked.message.from
    //     const { battery, licenseJwt } = unpacked.message.body

    //     const verification = await agent.verifyCredential({ credential: licenseJwt })

    //     if (verification.verified && verification.verifiableCredential.credentialSubject.id === senderDid) {
    //         console.log(`\n📥 [P2P Received]: Message verified from: ${senderDid}`);
    //         console.log(`📊 Data: Battery ${battery}%`);
    //         res.status(200).send('OK')
    //     } else {
    //         res.status(403).send('Valid License required to communicate')
    //     }
    //   } catch (e) {
    //     res.status(500).send('Error unpack')
    //   }
    // })

    // app.listen(P2P_PORT, '0.0.0.0', async () => {
    //   console.log(`🚀 Drone is listening for P2P messages on port ${P2P_PORT}`)

    //   registerInDirectory();

    //   startTelemetryLoop();

    //   const rl = readline.createInterface({
    //     input: process.stdin,
    //     output: process.stdout
    //   })
    //   const menu = () => {
    //     rl.question('\nEnter target drone DID to share metrics (or "exit" to quit): ', async (answer) => {
    //       if (answer.toLowerCase() === 'exit') {
    //         console.log('👋 Exiting Drone Agent...')
    //         rl.close()
    //         process.exit(0)
    //       } else {
    //         await talkToPeer(answer.trim())
    //         menu()
    //       }
    //     });
    //   }

    //   setTimeout(menu, 1000);
    // })

    registerInDirectory();
    startTelemetryLoop();

  } catch (error) {
    console.error('❌ Error: ', error)
  }
}

main()