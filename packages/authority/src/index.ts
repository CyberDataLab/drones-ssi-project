import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import { v4 as uuidv4 } from 'uuid' 
import * as fs from 'fs'
import * as path from 'path'
import { Bls12381G2KeyPair, BbsBlsSignature2020 } from '@mattrglobal/jsonld-signatures-bbs'
// @ts-ignore
import { extendContextLoader, sign, purposes } from 'jsonld-signatures'
import { AUTH } from 'sqlite3'



const AUTH_KEY_FILE = path.join(__dirname, '../keys/authority-key.json')
const PUBLIC_KEY_FILE = path.join(__dirname, '../keys/authority-public-key.json')

// Auxiliar function to read input from terminal
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

// To optimize cryptographic performance and avoid latency and Rate-Limiting locks on W3C servers, 
// an in-memory caching mechanism was implemented in the Linked Data resolver engine.
const contextCache = new Map();

const customLoader = async (url: string) => {

  if (contextCache.has(url)) {
    console.log(`⚡ [Context Cache Hit]: ${url}`)
    return contextCache.get(url);
  } 

  console.log(`🌐 [Loading W3C Context]: ${url}`)

  const response = await fetch(url, {
    headers: { 'Accept': 'application/ld+json, application/json' },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} while fetching context ${url}`)
  }

  const document = await response.json();

  const result = {
    contextUrl: null,
    documentUrl: url,
    document: document
  }

  contextCache.set(url, result);
  return result;
};

const documentLoader = extendContextLoader(customLoader);



async function main() {
  console.log('🏛️  Starting Certification Authority (Interactive Mode)')

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
    
    console.log(`✅ Active Authority: ${authorityIdentifier.did}`)
    console.log('-------------------------------------------------------')


    console.log('\n⚙️ Generating ney BLS12-381 key pair for signing credentials ZKP...')
    
    let bbsKeyPair;

    if (fs.existsSync(AUTH_KEY_FILE)) {
      console.log('🔑 Existing key pair found. Loading from file...')
      const savedKey = JSON.parse(fs.readFileSync(AUTH_KEY_FILE, 'utf-8'))
      bbsKeyPair = new Bls12381G2KeyPair({
        id: savedKey.id,
        controller: savedKey.controller,
        publicKeyBase58: savedKey.publicKey,
        privateKeyBase58: savedKey.privateKey
      })
    } else {
      console.log('🔑 No existing key pair found. Generating new one...')
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

      console.log(`🔐 New BLS12-381 key pair generated and saved to ${AUTH_KEY_FILE} and ${PUBLIC_KEY_FILE}`)
    }

    const targetDID = await openTerminal('👉 Please enter the drone DID (did:key:...): ')

    if (!targetDID || !targetDID.startsWith('did:')) {
        console.error('❌ Error: DID format not valid')
        return
    }

    console.log(`\n⚙️  Creating BBS+ license for: ${targetDID}...`)
    // Generate a unique license ID using UUID
    const licenseId = `urn:uuid:${uuidv4()}`;



    const credentialDocument = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/security/bbs/v1",
        // Custom attributes for the drone license (JSON-LD context)
        {
          "DroneLicense": "https://tfm.es/vocab#DroneLicense",
          "licenseClass": "https://tfm.es/vocab#licenseClass",
          "expiryDate": "https://tfm.es/vocab#expiryDate",
          // This could be used as domain identifiers (check it later)
          "authorizedArea": "https://tfm.es/vocab#authorizedArea"
        }
       ],
      "id": licenseId,
      "type": ['VerifiableCredential', 'DroneLicense'],
      "issuer": authorityIdentifier.did,
      "issuanceDate": new Date().toISOString(),
      "credentialSubject": {
        "id": targetDID,
        "type": "DroneLicense",
        "licenseClass": "Class-A",
        "expiryDate": "2030-01-01",
        "authorizedArea": "Murcia"
      }
    };


    const signedCredential = await sign(credentialDocument, {
      suite: new BbsBlsSignature2020({ key: bbsKeyPair }),
      purpose: new purposes.AssertionProofPurpose(),
      documentLoader: documentLoader
    });

    console.log('📜 Credential Created and Signed with BBS+!')

    const shortDID = targetDID.substring(0, 16);
    const outputFileName = `license-${shortDID}.json`;
    const outDir = path.join(process.cwd(), 'issued-licenses');
    
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir);
    }

    const outputPath = path.join(outDir, outputFileName);

    console.log('---------------------------------------------------')
    fs.writeFileSync(outputPath, JSON.stringify(signedCredential, null, 2), 'utf-8');
    console.log(`💾 Signed credential saved to: ${outputPath}`)
    console.log('---------------------------------------------------')

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()