import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { Bls12381G2KeyPair, BbsBlsSignature2020 } from '@mattrglobal/jsonld-signatures-bbs'
// @ts-ignore
import { extendContextLoader, sign, purposes } from 'jsonld-signatures'

const AUTH_KEY_FILE = path.join(__dirname, '../keys/authority-key.json')
const PUBLIC_KEY_FILE = path.join(__dirname, '../keys/authority-public-key.json')

// Auxiliary function to read input from terminal
function openTerminal(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// To optimize cryptographic performance and avoid latency and Rate-Limiting locks on W3C servers.
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
    throw new Error(`Error HTTP ${response.status} while fetching context ${url}`)
  }

  const result = {
    contextUrl: null,
    documentUrl: url,
    document: await response.json()
  }

  contextCache.set(url, result);
  return result;
};

const documentLoader = extendContextLoader(customLoader);

async function main() {
  console.log('🏛️  Starting Certification Authority (Interactive Mode)')
  console.log('=======================================================')

  const AUTHORITY_SECRET = '99999999cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8999'
  const DB_FILE = 'authority-database.sqlite'

  try {
    const agent = await createSSIAgent(DB_FILE, AUTHORITY_SECRET)

    let authorityIdentifier = (await agent.didManagerFind())[0]

    if (!authorityIdentifier) {
      authorityIdentifier = await agent.didManagerCreate({
        alias: 'Authority-01',
        provider: 'did:key'
      })
    }

    console.log(`✅ Active Authority: ${authorityIdentifier.did}\n`)

    let bbsKeyPair;
    if (fs.existsSync(AUTH_KEY_FILE)) {
      const savedKey = JSON.parse(fs.readFileSync(AUTH_KEY_FILE, 'utf-8'))
      bbsKeyPair = new Bls12381G2KeyPair({
        id: savedKey.id,
        controller: savedKey.controller,
        publicKeyBase58: savedKey.publicKey,
        privateKeyBase58: savedKey.privateKey
      })
    } else {
      console.log('🔑 Generating new BLS12-381 key pair...')
      bbsKeyPair = await Bls12381G2KeyPair.generate({
        id: `${authorityIdentifier.did}#bbs-key-1`,
        controller: authorityIdentifier.did
      })

      const keyData = {
        id: bbsKeyPair.id,
        controller: bbsKeyPair.controller,
        publicKey: bbsKeyPair.publicKey,
        privateKey: bbsKeyPair.privateKey
      }
      fs.writeFileSync(AUTH_KEY_FILE, JSON.stringify(keyData, null, 2), 'utf-8')

      const pubKeyExport = {
        id: bbsKeyPair.id,
        type: 'Bls12381G2Key2020',
        controller: bbsKeyPair.controller,
        publicKeyBase58: bbsKeyPair.publicKey
      };
      fs.writeFileSync(PUBLIC_KEY_FILE, JSON.stringify(pubKeyExport, null, 2), 'utf-8')
    }

    // --- INTERACTIVE MENU ---
    console.log('Select the type of license to issue:')
    console.log('  1. Drone (Long-term - 5y)')
    console.log('  2. Server (Short-lived - 24h)')

    const choice = await openTerminal('\n👉 Enter option (1 or 2): ')

    if (choice !== '1' && choice !== '2') {
      console.error('❌ Invalid option. Exiting.')
      return
    }

    const targetDID = await openTerminal('👉 Please enter the target DID (did:key:...): ')

    if (!targetDID || !targetDID.startsWith('did:')) {
      console.error('❌ Error: DID format not valid')
      return
    }

    const licenseId = `urn:uuid:${uuidv4()}`;
    const now = new Date();

    let credentialDocument: any = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/security/bbs/v1",
        {
          "DroneLicense": "https://tfm.es/vocab#DroneLicense",
          "ServerOperationLicense": "https://tfm.es/vocab#ServerOperationLicense",
          "licenseClass": "https://tfm.es/vocab#licenseClass",
          "authorizedArea": "https://tfm.es/vocab#authorizedArea",
          "operationalRole": "https://tfm.es/vocab#operationalRole"
        }
      ],
      "id": licenseId,
      "issuer": authorityIdentifier.did,
      "issuanceDate": now.toISOString(),
    };

    let outputPrefix = "";

    // --- DYNAMIC CREDENTIAL CONSTRUCTION ---
    if (choice === '1') {
      console.log(`\n⚙️  Creating BBS+ Drone License for: ${targetDID}...`)
      outputPrefix = "drone-license";

      credentialDocument.type = ['VerifiableCredential', 'DroneLicense'];
      credentialDocument.credentialSubject = {
        id: targetDID,
        type: "DroneLicense",
        licenseClass: "Class-A",
        authorizedArea: "Murcia"
      };
      // Drones get a 5-year validity
      const expiry = new Date(now);
      expiry.setFullYear(now.getFullYear() + 5);
      credentialDocument.expirationDate = expiry.toISOString();

    } else if (choice === '2') {
      console.log(`\n⚙️  Creating BBS+ Server License for: ${targetDID}...`)
      outputPrefix = "server-license";

      credentialDocument.type = ['VerifiableCredential', 'ServerOperationLicense'];
      credentialDocument.credentialSubject = {
        id: targetDID,
        type: "ServerOperationLicense",
        operationalRole: "Telemetry-Aggregation-Node"
      };
      // Servers get a 24-hour credential
      const expiry = new Date(now);
      expiry.setHours(now.getHours() + 24);
      credentialDocument.expirationDate = expiry.toISOString();
    }

    // --- SIGNING AND ENCRYPTION ---
    const signedCredential = await sign(credentialDocument, {
      suite: new BbsBlsSignature2020({ key: bbsKeyPair }),
      purpose: new purposes.AssertionProofPurpose(),
      documentLoader: documentLoader
    });

    console.log('📜 Credential Created and Signed with BBS+!')
    console.log('🔒 Encrypting license into a JWE specifically for the target DID...')

    const licenseMessage = {
      id: `license-msg-${Date.now()}`,
      type: "https://didcomm.org/provisioning/1.0/secure-license",
      from: authorityIdentifier.did,
      to: [targetDID],
      body: {
        credential: signedCredential
      }
    };

    const packedMessage = await agent.packDIDCommMessage({
      packing: "authcrypt",
      message: licenseMessage,
    });

    const shortDID = targetDID.substring(0, 16);
    const outputFileName = `${outputPrefix}-${shortDID}.jwe`;
    const outDir = path.join(process.cwd(), 'issued-licenses');

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir);
    }

    const outputPath = path.join(outDir, outputFileName);

    console.log('---------------------------------------------------')
    fs.writeFileSync(outputPath, packedMessage.message, 'utf-8');
    console.log(`💾 Encrypted JWE license saved securely to: ${outputPath}`)
    console.log(`⏳ License Valid Until: ${credentialDocument.expirationDate}`)
    console.log('---------------------------------------------------')

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()