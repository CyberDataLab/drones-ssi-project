import { createSSIAgent } from '@tfm/shared';
import { preloadedContexts } from '../cache/cache-contexts';
import * as fs from 'fs';
import { BbsBlsSignature2020 } from '@mattrglobal/jsonld-signatures-bbs';
// @ts-ignore
import { extendContextLoader, purposes, verify } from 'jsonld-signatures';
import { CONFIG } from '../config/env';

export class SSIService {
    public agent: any;
    public serverDid: string = '';
    public serverCredential: any;
    private documentLoader: any;

    async initialize() {
        console.log('🤖 Initializing SSI Agent...');
        this.agent = await createSSIAgent(CONFIG.DB_FILE, CONFIG.SERVER_SECRET_KEY);

        const existingDids = await this.agent.didManagerFind();
        const serverIdentifier = existingDids.length > 0
            ? existingDids[0]
            : await this.agent.didManagerCreate({ alias: 'AI-Server-01', provider: 'did:key' });

        this.serverDid = serverIdentifier.did;
        console.log(`✅ Server Identifier (DID): ${this.serverDid}`);

        await this.loadAndDecryptLicense();
        this.setupDocumentLoader();
    }

    private async loadAndDecryptLicense() {
        if (!fs.existsSync(CONFIG.LOCAL_LICENSE_FILE)) {
            console.warn('⚠️ No local license found. Please obtain one from the CA.');
            process.exit(1);
        }

        const encryptedBlob = fs.readFileSync(CONFIG.LOCAL_LICENSE_FILE, "utf-8");
        try {
            const unpacked = await this.agent.unpackDIDCommMessage({ message: encryptedBlob });
            if (unpacked.message.type === "https://didcomm.org/provisioning/1.0/secure-license") {
                this.serverCredential = unpacked.message.body.credential;
                console.log(`🔓 Success! License decrypted in RAM`);
            } else {
                throw new Error('Invalid message type in license file.');
            }
        } catch (error) {
            console.error("⛔ ERROR: Could not decrypt the license.", error);
            process.exit(1);
        }
    }

    private setupDocumentLoader() {
        const contextCache = new Map();
        for (const [url, data] of Object.entries(preloadedContexts)) {
            contextCache.set(url, data);
        }

        const customLoader = async (url: string) => {
            if (contextCache.has(url)) return contextCache.get(url);

            if (url.startsWith('did:')) {
                const baseDid = url.split('#')[0];
                const resolution = await this.agent.resolveDid({ didUrl: baseDid });

                if (!resolution?.didDocument) throw new Error(`Failed to resolve DID: ${url}`);

                // Inject Authority Public Key if needed
                if (fs.existsSync(CONFIG.PUB_KEY_AUTHORITY)) {
                    const authKey = JSON.parse(fs.readFileSync(CONFIG.PUB_KEY_AUTHORITY, 'utf-8'));
                    if (baseDid === authKey.controller) {
                        resolution.didDocument.verificationMethod = resolution.didDocument.verificationMethod || [];
                        resolution.didDocument.assertionMethod = resolution.didDocument.assertionMethod || [];

                        if (!resolution.didDocument.verificationMethod.find((v: any) => v.id === authKey.id)) {
                            resolution.didDocument.verificationMethod.push(authKey);
                            resolution.didDocument.assertionMethod.push(authKey.id);
                        }
                    }
                }

                const result = { contextUrl: null, documentUrl: url, document: resolution.didDocument };
                contextCache.set(url, result);
                return result;
            }

            const response = await fetch(url, { headers: { 'Accept': 'application/ld+json' } });
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            const result = { contextUrl: null, documentUrl: url, document: await response.json() };
            contextCache.set(url, result);
            return result;
        };

        this.documentLoader = extendContextLoader(customLoader);
    }

    async unpackMessage(encryptedMessage: string) {
        return await this.agent.unpackDIDCommMessage({ message: encryptedMessage });
    }

    async verifyCredential(credential: any): Promise<{ verified: boolean, error?: any }> {
        try {
            const result = await this.agent.verifyCredential({ credential });
            return result;
        } catch (error) {
            console.error("[SSI] ❌ Exception thrown during VC verification:", error);
            return { verified: false, error };
        }
    }
}