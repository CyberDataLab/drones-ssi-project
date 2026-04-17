import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'

const LOCAL_LICENSE_FILE = path.join(__dirname, '../license/drone-license.jwe')
const CONFIG_FILE = path.join(__dirname, '../drone-config.json')
const DB_FILE = 'drone-database.sqlite'
const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'

function ask(pregunta: string): Promise<string> {
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
            // Private keys are created here
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
        console.log('2. Go to the Authority terminal and generate a BBS+ license for this DID.')
        console.log('3. Rename it to "drone-license.jwe" and place it in the "license" folder.')
        console.log('-------------------------------------------------------------\n')


        const serverDid = await ask('📡 Enter the DID of the Server: ')
        if (!serverDid.startsWith('did:')) {
            console.error('❌ Error: Invalid DID format.')
            return
        }

        if (!fs.existsSync(LOCAL_LICENSE_FILE)) {
            console.error(`❌ Error: License file not found at ${LOCAL_LICENSE_FILE}. Please place the "drone-license.json" file in the "drone" folder.`)
            return
        }

        console.log('\n🔐 Decrypting JWE and verifying credential structure...')

        const encryptedBlob = fs.readFileSync(LOCAL_LICENSE_FILE, 'utf-8')
        let licenseData;

        try {
            // 2. Unpack (decrypt) the DIDComm message using the drone's private keys
            const unpacked = await agent.unpackDIDCommMessage({ message: encryptedBlob })

            // 3. Verify it's the correct message type and extract the credential payload
            if (unpacked.message.type === "https://didcomm.org/provisioning/1.0/secure-license") {
                licenseData = unpacked.message.body.credential;
                console.log('🔓 Successfully decrypted the license in memory!')
            } else {
                throw new Error(`Invalid DIDComm message type. Received: ${unpacked.message.type}`);
            }
        } catch (e) {
            console.error('❌ Error: Could not decrypt the license. Is this JWE meant for this Drone DID?', e)
            return
        }

        if (licenseData.credentialSubject?.id !== droneDID) {
            console.log(`❌ Error: This license belongs to ${licenseData.credentialSubject?.id}, not to me (${droneDID})!`)
            return
        }

        if (licenseData.proof?.type !== 'BbsBlsSignature2020') {
            console.log('❌ Error: The license is not signed with BBS+ (BbsBlsSignature2020).')
            return
        }

        console.log('\n💾 Saving configuration and copying license...')

        const config = { serverDid: serverDid }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))


        console.log('✅ BBS+ license successfully installed as drone-license.json.')
        console.log('✅ Server configuration saved.')
        console.log('\n🎉 DONE! Run "npm start" to start the drone.')


    } catch (error) {
        console.error('❌ Error:', error)
    }
}

main()