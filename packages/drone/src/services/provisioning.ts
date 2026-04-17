import * as fs from 'fs';
import * as readline from 'readline';
import { config } from '../config/env';

function ask(pregunta: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(pregunta, (respuesta) => {
            rl.close();
            resolve(respuesta.trim());
        });
    });
}

export async function runProvisioning(agent: any) {
    console.log('\n🛠️  [PROVISIONING MODE] Checking system status...');

    // 1. Identity Check
    let identifiers = await agent.didManagerFind();
    let droneDID: string;

    if (identifiers.length === 0) {
        console.log('✨ Regenerating Identity from Mathematical Seed (RAM Mode)...');

        // We force Veramo to build the DID using our injected Hex Key
        const newId = await agent.didManagerCreate({
            alias: 'Dron-01',
            provider: 'did:key',
            options: {
                keyType: 'Ed25519',
                privateKeyHex: config.PRIVATE_KEY_HEX
            }
        });
        droneDID = newId.did;

    } else {
        droneDID = identifiers[0].did;
        console.log('ℹ️  Existing Identity Found');
    }

    console.log('\n-------------------------------------------------------------');
    console.log('🤖 DRONE IDENTITY:');
    console.log(`👉 ${droneDID}`);
    console.log('-------------------------------------------------------------');

    // 2. Server Configuration Check
    let serverDid = "";
    if (fs.existsSync(config.CONFIG_FILE)) {
        const savedConfig = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf-8'));
        serverDid = savedConfig.serverDid;
        console.log('ℹ️  Existing Server Configuration Found');
    } else {
        serverDid = await ask('📡 Enter the DID of the Server: ');

        if (!serverDid.startsWith('did:')) {
            throw new Error('Invalid DID format.');
        }

        fs.writeFileSync(config.CONFIG_FILE, JSON.stringify({ serverDid }, null, 2));
        console.log('✅ Server configuration saved.');
    }

    // 3. License Wait and Decrypt (Polling Loop)
    let myBbsCredential = null;

    if (!fs.existsSync(config.LOCAL_LICENSE_FILE)) {
        console.log('\n-------------------------------------------------------------');
        console.log('📋 INSTRUCTIONS:');
        console.log('1. Go to the Authority terminal and generate a BBS+ license for this DID.');
        console.log('2. Rename it to "drone-license.jwe" and place it in the "license" folder.');
        console.log('-------------------------------------------------------------\n');
        process.stdout.write('⏳ Waiting for secure JWE license deployment');
    }

    while (!myBbsCredential) {
        if (fs.existsSync(config.LOCAL_LICENSE_FILE)) {
            try {
                const encryptedBlob = fs.readFileSync(config.LOCAL_LICENSE_FILE, 'utf-8');
                const unpacked = await agent.unpackDIDCommMessage({ message: encryptedBlob });

                if (unpacked.message.type === "https://didcomm.org/provisioning/1.0/secure-license") {
                    const licenseData = unpacked.message.body.credential;

                    if (licenseData.credentialSubject?.id === droneDID && licenseData.proof?.type === 'BbsBlsSignature2020') {
                        myBbsCredential = licenseData;
                        console.log('\n\n🔓 [SECURE] Valid License successfully decrypted in memory!');
                        break; // Exit the loop
                    } else {
                        console.log('\n⚠️ Found license, but identity mismatch or wrong signature type. Ignoring...');
                        // Wait a bit longer to prevent console spam if an invalid file is left there
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            } catch (e) {
                // Silent catch: file might be half-written by the OS, or decryption failed.
            }
        } else {
            // Print a dot every 3 seconds to show it's alive
            process.stdout.write('.');
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return { droneDID, serverDid, myBbsCredential };
}