import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'

const CONFIG_FILE = path.join(__dirname, '../drone-config.json')
const DB_FILE = 'drone-database.sqlite'
const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'

function preguntar(pregunta: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close()
      resolve(respuesta.trim())
    })
  })
}

async function main() {
  console.log('🛠️  STARTING INITIAL DRONE CONFIGURATION')
  console.log('==========================================')

  try {
    console.log('⚙️  Initializing SSI Agent...')
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY)

    const identifiers = await agent.didManagerFind()
    let droneDID: string

    if (identifiers.length === 0) {
        console.log('✨ Generating a new DID for the drone...')
        const newId = await agent.didManagerCreate({ alias: 'Dron-01', provider: 'did:key' })
        droneDID = newId.did
    } else {
        droneDID = identifiers[0].did
        console.log('ℹ️  Existing Identity Found')
    }

    console.log('\n-------------------------------------------------------------')
    console.log('🤖 IDENTITY:')
    console.log(`👉 ${droneDID}`)
    console.log('-------------------------------------------------------------')
    console.log('📋 INSTRUCTIONS:')
    console.log('1. Copy the DID above.')
    console.log('2. Go to the Authority terminal and generate a license for this DID.')
    console.log('3. Come back here when you have the JWT.')
    console.log('-------------------------------------------------------------\n')

    
    const serverDid = await preguntar('📡 Step 1: Enter the DID of the Server: ')
    if (!serverDid.startsWith('did:')) {
        console.error('❌ Error: Invalid DID format.')
        return
    }

    const jwtInput = await preguntar('🎫 Step 2: Paste the generated License (JWT): ')
    if (!jwtInput) {
        console.error('❌ Error: The license is required.')
        return
    }

    console.log('\n💾 Saving configuration...')
    
    const config = { serverDid: serverDid }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

    const result = await agent.verifyCredential({ credential: jwtInput })
    if (result.verified) {
        await agent.dataStoreSaveVerifiableCredential({
            verifiableCredential: result.verifiableCredential
        })
        console.log('✅ Valid license installed.')
        console.log('✅ Server configuration saved.')
        console.log('\n🎉 DONE! Run "npm start" to start the drone.')
    } else {
        console.error('❌ The license is not valid. Configuration aborted.')
        if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()