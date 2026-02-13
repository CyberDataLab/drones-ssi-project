import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import { v4 as uuidv4 } from 'uuid' 

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

    const targetDID = await openTerminal('👉 Please enter the drone DID (did:key:...): ')

    if (!targetDID || !targetDID.startsWith('did:')) {
        console.error('❌ Error: DID format not valid')
        return
    }

    console.log(`\n⚙️  Creating license for: ${targetDID}...`)

    // Generate a unique license ID using UUID
    const licenseId = `urn:uuid:${uuidv4()}`;

    // Create and sign the Verifiable Credential with the license information
    const verifiableCredential = await agent.createVerifiableCredential({
      credential: {
        id: licenseId, 
        issuer: { id: authorityIdentifier.did },
        credentialSubject: {
          id: targetDID,
          type: 'DroneLicense',
          licenseClass: 'Class-A',
          expiryDate: '2030-01-01',
          authorizedArea: 'Madrid-Norte'
        },
      },
      proofFormat: 'jwt',
      save: true
    })

    console.log('📜 Credential Created and Signed!')
    console.log(`🔑 License ID: ${licenseId}`) // Show the ID
    console.log('---------------------------------------------------')
    console.log(verifiableCredential.proof.jwt)
    console.log('---------------------------------------------------')
    console.log('✅ Copy the JWT above and use it in the drone installation script.')

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()