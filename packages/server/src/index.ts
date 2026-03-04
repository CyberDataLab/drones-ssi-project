import { createSSIAgent } from '@tfm/shared'
import { preloadedContexts } from './cache-contexts'
import { BlockchainService } from './blockchain'
import express, { Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as jwt from 'jsonwebtoken'
import * as bcrypt from 'bcryptjs'
import { BbsBlsSignature2020 } from '@mattrglobal/jsonld-signatures-bbs'
// @ts-ignore
import { extendContextLoader, purposes, verify } from 'jsonld-signatures'


// Authority public Key
const PUB_KEY_AUTHORITY = path.join(__dirname, '../authority_public_key/authority-public-key.json')

// Dashboard credentials and configuration
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

async function initializeSystem() {
  const users = getUsers();
  if (users.length > 0) return;

  console.log('🔐 No users found. Creating default admin user...');
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
  if (!token) return res.status(401).json({ error: 'Token not provided' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}


const requireAdmin = (req: any, res: Response, next: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied: Only administrators can perform this action' });
  next();
}


async function main() {
  console.log('🖥️  Initilizing Server')
  await initializeSystem()

  const SERVER_SECRET_KEY = '55555555cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8555'
  const DB_FILE = 'server-database.sqlite'
  const PORT = 3000

  const droneDirectory = new Map<string, string>()
  const DATASET_FILE = path.join(__dirname, '../drones-dataset.csv')

  if (!fs.existsSync(DATASET_FILE)) {
    fs.writeFileSync(DATASET_FILE, 'timestamp,did,battery,altitude,temperature\n')
    console.log('📁 Nuevo dataset creado: drones-dataset.csv')
  }

  const bcService = new BlockchainService()
  try {
    await bcService.connect()
    console.log('✅ Connection established with Hyperledger Fabric')
  } catch (error) {
    console.error('⚠️  WARNING: Unable to connect to Blockchain. The server will operate in local mode, but writing to the Ledger will fail.')
  }

  try {
    const agent = await createSSIAgent(DB_FILE, SERVER_SECRET_KEY)

    const existingDids = await agent.didManagerFind()
    let serverIdentifier = existingDids.length > 0
      ? existingDids[0]
      : await agent.didManagerCreate({ alias: 'AI-Server-01', provider: 'did:key' })

    console.log(`✅ Server Identifier (DID): ${serverIdentifier.did}`)
    console.log('---------------------------------------------------------')


    const contextCache = new Map();

    for (const [url, data] of Object.entries(preloadedContexts)) {
      contextCache.set(url, data);
    }

    const customLoader = async (url: string) => {
      if (contextCache.has(url)) return contextCache.get(url);

      // If the library requests a DID to resolve its public key, we use Veramo to resolve it
      if (url.startsWith('did:')) {
        console.log(`🔍 [ZKP] Resolving public key for DID: ${url}`);
        const baseDid = url.split('#')[0]; // Remove fragment if present, as Veramo resolves the base DID
        const resolution = await agent.resolveDid({ didUrl: baseDid });

        if (!resolution || !resolution.didDocument) {
          throw new Error(`Failed to resolve DID document for URL: ${url}`);
        }

        if (fs.existsSync(PUB_KEY_AUTHORITY)) {
          const authorityPublicKey = JSON.parse(fs.readFileSync(PUB_KEY_AUTHORITY, 'utf-8'))

          if (baseDid === authorityPublicKey.controller) {
            if (!resolution.didDocument.verificationMethod) resolution.didDocument.verificationMethod = [];
            if (!resolution.didDocument.assertionMethod) resolution.didDocument.assertionMethod = [];

            const exists = resolution.didDocument.verificationMethod.find((v: any) => v.id === authorityPublicKey.id);
            if (!exists) {
              resolution.didDocument.verificationMethod.push(authorityPublicKey);
              resolution.didDocument.assertionMethod.push(authorityPublicKey.id);
              console.log(`💉 [ZKP] Public key injected into DID document for controller: ${authorityPublicKey.controller}`);
            }
          }
        }

        const result = {
          contextUrl: null,
          documentUrl: url,
          document: resolution.didDocument
        };
        contextCache.set(url, result);
        return result;
      }

      // For regular contexts, we fetch them as usual
      const response = await fetch(url, {
        headers: { 'Accept': 'application/ld+json, application/json' },
        redirect: 'follow'
      });
      if (!response.ok) throw new Error(`Error HTTP ${response.status} downloading the context: ${url}`);
      const result = { contextUrl: null, documentUrl: url, document: await response.json() };
      contextCache.set(url, result);
      return result;
    };
    const documentLoader = extendContextLoader(customLoader);

    const app = express()
    app.use(express.json())
    app.use(express.static(path.join(__dirname, '../public')))

    app.post('/auth/login', async (req: Request, res: Response) => {
      const { username, password } = req.body;
      const users = getUsers();
      const user = users.find(u => u.username === username);
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid Credentials' });

      const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
      res.json({ token, role: user.role, username: user.username });
    });

    app.post('/auth/register', authenticateToken, requireAdmin, async (req: any, res: Response) => {
      const { username, password, role } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

      const users = getUsers();
      if (users.find(u => u.username === username)) return res.status(400).json({ error: 'User already exists' });

      const hashedPassword = await bcrypt.hash(password, 10);
      users.push({ username, passwordHash: hashedPassword, role: role === 'admin' ? 'admin' : 'auditor' });
      fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
      res.json({ message: 'User Created Successfully' });
    });

    app.post('/messaging', express.text({ type: '*/*' }), async (req: Request, res: Response) => {
      try {
        console.log('📩 Receiving DIDComm message...')

        const unpacked = await agent.unpackDIDCommMessage({
          message: req.body,
        })

        const message = unpacked.message;
        const droneDid = message.from;
        const body = message.body;
        const credentials = body.verifiableCredential;

        if (!credentials || credentials.length === 0) {
          console.warn('⚠️  Message received without credentials from DID:', droneDid);
          res.status(401).send('No credentials provided');
          return;
        }

        const targetCredential = credentials[0];

        if (targetCredential.proof?.type !== 'BbsBlsSignature2020') {
          console.warn(`⚠️  Unsupported credential proof type from DID: ${droneDid}. Expected BbsBlsSignature2020 but got ${targetCredential.proof?.type}`);
          res.status(400).json({ error: 'unsupported_credential', message: 'Only BbsBlsSignature2020 credentials are accepted.' });
          return;
        }

        let isVerified = false;
        try {
          const verificationResult = await verify(targetCredential, {
            suite: new BbsBlsSignature2020(),
            purpose: new purposes.AssertionProofPurpose(),
            documentLoader: documentLoader
          });
          isVerified = verificationResult.verified;
          console.log(`🔍[DEBUG] Credential verification result for DID ${droneDid}: ${isVerified ? '✅ Verified' : '❌ Failed'}`);

          // DEBUG
          if (!isVerified) {
            if (verificationResult.error) {
              console.error(`❌ Verification error details for DID ${droneDid}:`, verificationResult.error);
            }
            if (verificationResult.results) {
              verificationResult.results.forEach((result: any, index: number) => {
                console.error(`❌ Proof ${index + 1} verification result:`, result.verified ? '✅ Verified' : '❌ Failed');
                if (result.error) {
                  console.error(`   Error details for proof ${index + 1}:`, result.error);
                }
              });
            }
          }

        } catch (e) {
          console.error(`❌ Error during credential verification for DID: ${droneDid}`, e);
          res.status(400).json({ error: 'credential_verification_failed', message: 'An error occurred while verifying the credential.' });
          return;
        }

        if (isVerified === true) {

          if (targetCredential.credentialSubject?.id !== droneDid) {
            console.error(`⛔ Security Alert: Credential subject DID (${targetCredential.credentialSubject?.id}) does not match sender DID (${droneDid}). Possible identity mismatch or tampering attempt.`);
            return res.status(403).json({ error: 'identity_mismatch', message: 'The credential does not belong to you.' });
          }

          const credentialId = targetCredential.id;
          if (!credentialId) {
            return res.status(400).json({ error: 'invalid_credential', message: 'Credential must have an ID.' });
          }

          console.log(`✅ Credential verified successfully for DID: ${droneDid}. Credential ID: ${credentialId}`);

          try {
            const isRevoked = await bcService.isRevoked(credentialId);
            if (isRevoked) {
              console.warn(`⚠️  Credential with ID ${credentialId} is revoked.`);
              return res.status(400).json({ error: 'revoked_credential', message: 'The credential has been revoked.' });
            }
          } catch (revocationError) {
            console.error(`❌ Error checking revocation status for credential ID: ${credentialId}`, revocationError);
            return res.status(500).json({ error: 'revocation_check_failed', message: 'An error occurred while checking credential revocation status.' });
          }

          const battery = body.battery ?? 0;
          const altitude = body.altitude ?? 0;
          const temperature = body.temperature ?? body.temp ?? 0;
          const timestamp = body.timestamp || new Date().toISOString();

          const csvLine = `${timestamp},${droneDid},${battery},${altitude},${temperature}\n`
          fs.appendFileSync(DATASET_FILE, csvLine)

          try {
            const recordId = `flight-${Date.now()}`;
            await bcService.createTelemetry(recordId, timestamp, droneDid || 'unknown_did', battery, altitude, temperature)
          } catch (bcError) {
            console.error('❌ Error writing to Blockchain:', bcError)
          }

          res.json({ status: 'success', message: 'Data verified and saved on-chain' })

        } else {
          console.warn(`⚠️  Credential verification failed for DID: ${droneDid}. Possible tampering or invalid credential`);
          res.status(400).json({ error: 'invalid_credential', message: 'Credential verification failed. Data not accepted.' });
        }

      } catch (error) {
        console.error('❌ Error processing DIDComm message:', error);
        res.status(500).send('Internal Server Error');

      }
    })


    app.post('/directory', (req: Request, res: Response) => {
      const { action, did, endpoint } = req.body;
      if (action === 'register') {
        droneDirectory.set(did, endpoint);
        console.log(`📇 Local Directory Registration: ${did} -> ${endpoint}`);
        return res.status(200).json({ status: 'registered' });
      }
      if (action === 'lookup') {
        const targetEndpoint = droneDirectory.get(did);
        return targetEndpoint
          ? res.status(200).json({ endpoint: targetEndpoint })
          : res.status(404).json({ error: 'Not Found' });
      }
      res.status(400).send('Invalid action.');
    });

    app.get('/history/:did', authenticateToken, async (req: Request, res: Response) => {
      try {
        const didParam = req.params.did as string;
        const cleanDid = decodeURIComponent(didParam);
        const data = await bcService.getTelemetryByDid(cleanDid);

        res.json(JSON.parse(data));
      } catch (error) {
        console.error('❌ Error obtaining telemetry data:', error);
        res.status(500).send({ error: 'Error obtaining telemetry data from Blockchain' });
      }
    });

    app.get('/drones', authenticateToken, async (req: Request, res: Response) => {
      try {
        const drones = await bcService.getAllDrones();
        res.json(drones);
      } catch (error) {
        console.error('❌ Error obtaining drones list:', error);
        res.status(500).send({ error: 'Blockchain Error' });
      }
    });

    app.post('/register', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
      try {
        const { droneDid, name } = req.body;

        if (!droneDid || !name) {
          return res.status(400).json({ error: 'Missing data (DID or Name)' });
        }

        await bcService.registerDrone(droneDid, name);
        res.json({ status: 'success', message: `Drone ${name} registered successfully` });

      } catch (error) {
        console.error('❌ Error registering drone:', error);
        res.status(500).json({ error: 'Internal Blockchain error while registering drone' });
      }
    });

    app.post('/revoke', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
      try {
        const { credentialId } = req.body;
        if (!credentialId) {
          return res.status(400).json({ error: 'Missing credential ID' });
        }

        await bcService.revokeCredential(credentialId);
        console.log(`⛔ Credential revoked via API: ${credentialId}`);

        res.json({ status: 'success', message: 'Credential revoked successfully' });
      } catch (e) {
        console.error('❌ Error revoking credential: ', e);
        res.status(500).json({ error: 'Error revoking credential in Blockchain' });
      }
    });

    app.get('/revocations', authenticateToken, async (req: Request, res: Response) => {
      try {
        const list = await bcService.getRevocationList();
        res.json(list);
      } catch (error) {
        console.error('❌ Error obtaining revocation list:', error);
        res.status(500).json({ error: 'Blockchain Error' });
      }
    });

    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, '../certs/server.key')),
      cert: fs.readFileSync(path.join(__dirname, '../certs/server.cert'))
    };

    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`\n🔒 Server available on port ${PORT}`);
      console.log(`   ➜ Dashboard: https://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Fatal error::', error)
  }
}

main()