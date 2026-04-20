import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';


const mspId = 'Org1MSP';
const cryptoPath = path.resolve(__dirname, '../../../../fabric-network/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/keystore');
const certPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/signcerts/cert.pem');
const tlsCertPath = path.resolve(cryptoPath, 'peers/peer0.org1.example.com/tls/ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';
const channelName = 'mychannel';
const chaincodeName = 'drone';

export class BlockchainService {
    private contract: Contract | undefined;
    private client: grpc.Client | undefined;
    private gateway: any | undefined;

    constructor() {
        console.log('🔗 Initializing Blockchain service...');
    }

    public async connect() {
        try {
            const rootCert = await fs.promises.readFile(tlsCertPath);
            const tlsCredentials = grpc.credentials.createSsl(rootCert);

            this.client = new grpc.Client(peerEndpoint, tlsCredentials, {
                'grpc.ssl_target_name_override': peerHostAlias,
            });

            console.log('⏳ Waiting for gRPC connection to the peer to be ready...');

            const deadline = new Date(Date.now() + 5000);

            await new Promise<void>((resolve, reject) => {
                this.client!.waitForReady(deadline, (error: Error | undefined) => {
                    if (error) {
                        reject(new Error(`Failed to connect to peer at ${peerEndpoint}: ${error.message}`));
                    } else {
                        resolve();
                    }
                });
            });

            const id = await this.newIdentity();
            const signer = await this.newSigner();

            this.gateway = connect({
                client: this.client,
                identity: id,
                signer: signer,
                evaluateOptions: () => { return { deadline: Date.now() + 5000 }; },
                endorseOptions: () => { return { deadline: Date.now() + 15000 }; },
                submitOptions: () => { return { deadline: Date.now() + 5000 }; },
                commitStatusOptions: () => { return { deadline: Date.now() + 60000 }; },
            });

            const network = this.gateway.getNetwork(channelName);
            this.contract = network.getContract(chaincodeName);

            console.log(`✅ Connection established with contract '${chaincodeName}'`);

        } catch (error) {
            console.error('❌ Error connecting to Fabric:', error);
            throw error;
        }
    }

    public async createTelemetry(txId: string, timestamp: string, droneDid: string, battery: number, altitude: number, temperature: number) {
        if (!this.contract) throw new Error('Contract not initialized');

        try {
            console.log(`⚡ Attempting to submitTransaction for: ${txId}`);

            await this.contract.submitTransaction(
                'CreateTelemetry',
                txId,
                timestamp,
                droneDid,
                battery.toString(),
                altitude.toString(),
                temperature.toString()
            );

            console.log('✅ Transaction successfully written to Ledger');
        } catch (error: any) {
            console.error('❌ Detailed error from Fabric Gateway:');
            if (error.details && error.details.length > 0) {
                console.error(`📝 Detail: ${error.details[0].message}`);
            } else {
                console.error(error);
            }
            throw error;
        }
    }

    public async getAllTelemetry(): Promise<string> {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log('🔍 Checking Ledger...');
        const resultBytes = await this.contract.evaluateTransaction('GetAllTelemetry');

        const resultString = new TextDecoder().decode(resultBytes);
        return resultString;
    }

    public async getTelemetryByDid(droneDid: string): Promise<string> {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log(`🔍 Checking telemetry for DID: ${droneDid}`);

        const resultBytes = await this.contract.evaluateTransaction('QueryTelemetryByDid', droneDid);
        const resultString = new TextDecoder().decode(resultBytes);

        return resultString;
    }

    private async newIdentity(): Promise<Identity> {
        const credentials = await fs.promises.readFile(certPath);
        return { mspId, credentials };
    }

    private async newSigner(): Promise<Signer> {
        const files = await fs.promises.readdir(keyDirectoryPath);
        const keyPath = path.resolve(keyDirectoryPath, files[0]);
        const privateKeyPem = await fs.promises.readFile(keyPath);
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        return signers.newPrivateKeySigner(privateKey);
    }

    public async getRegisteredDrones(): Promise<any[]> {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log('🔍 Checking Registered Drones in Blockchain...');

        const resultBytes = await this.contract.evaluateTransaction('GetRegisteredDrones');
        const resultString = new TextDecoder().decode(resultBytes);
        try {
            return JSON.parse(resultString);
        } catch (e) {
            console.error("Error parsing JSON from drones:", e);
            return [];
        }
    }

    public async getAllDrones(): Promise<any[]> {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log('🔍 Checking global drones census...');
        const resultBytes = await this.contract.evaluateTransaction('GetAllDronesInLedger');

        return JSON.parse(new TextDecoder().decode(resultBytes));
    }

    public async registerDrone(droneDid: string, name: string) {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log(`📝 Registering a new drone: ${name} (${droneDid})`);

        const timestamp = new Date().toISOString();

        await this.contract.submitTransaction(
            'RegisterDrone',
            droneDid,
            name,
            timestamp
        );
        console.log(`✅ Drone successfully registered.`);
    }


    public async revokeCredential(credentialId: string) {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log(`⛔ Revoking credential: ${credentialId}`);

        const timestamp = new Date().toISOString();

        await this.contract.submitTransaction(
            'RevokeCredential',
            credentialId,
            timestamp
        );
        console.log(`✅ Revocation confirmed in Blockchain.`);
    }

    public async isRevoked(credentialId: string): Promise<boolean> {
        if (!this.contract) throw new Error('Contract not initialized');

        const resultBytes = await this.contract.evaluateTransaction('IsCredentialRevoked', credentialId);
        const resultString = new TextDecoder().decode(resultBytes);

        return resultString === 'true';
    }

    public async getRevocationList(): Promise<any[]> {
        if (!this.contract) throw new Error('Contract not initialized');

        console.log('🔍 Checking the Blacklist on Blockchain...');
        const resultBytes = await this.contract.evaluateTransaction('GetRevocationList');

        return JSON.parse(new TextDecoder().decode(resultBytes));
    }
}