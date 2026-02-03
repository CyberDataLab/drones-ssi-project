import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';

// --- RUTAS DE LA RED (Ajustadas a tu VM) ---
const mspId = 'Org1MSP';
const cryptoPath = path.resolve(__dirname, '../../../fabric-network/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');

// Usamos ADMIN porque es más fiable en pruebas
const keyDirectoryPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/keystore');
const certPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/signcerts/cert.pem'); 

const tlsCertPath = path.resolve(cryptoPath, 'peers/peer0.org1.example.com/tls/ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

const channelName = 'mychannel';
const chaincodeName = 'drone'; // <--- CAMBIO IMPORTANTE: Nombre de TU contrato

export class BlockchainService {
    private contract: Contract | undefined;
    private client: grpc.Client | undefined;
    private gateway: any | undefined;

    constructor() {
        console.log('🔗 Inicializando servicio Blockchain...');
    }

    public async connect() {
        try {
            const rootCert = await fs.promises.readFile(tlsCertPath);
            const tlsCredentials = grpc.credentials.createSsl(rootCert);

            this.client = new grpc.Client(peerEndpoint, tlsCredentials, {
                'grpc.ssl_target_name_override': peerHostAlias,
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

            console.log(`✅ Conexión establecida con contrato '${chaincodeName}'`);

        } catch (error) {
            console.error('❌ Error conectando a Fabric:', error);
            throw error;
        }
    }

    // --- NUEVA FUNCIÓN ADAPTADA A TU CONTRATO ---
    public async createTelemetry(txId: string, timestamp: string, droneDid: string, battery: number, altitude: number, temperature: number) {
        if (!this.contract) throw new Error('Contrato no inicializado');

        try {
            console.log(`⚡ Intentando submitTransaction para: ${txId}`);
            
            // IMPORTANTE: Verifica si en tu Chaincode la función se llama 
            // 'CreateTelemetry' o 'CreateAsset'
            await this.contract.submitTransaction(
                'CreateTelemetry', 
                txId,
                timestamp,
                droneDid,
                battery.toString(),
                altitude.toString(),
                temperature.toString()
            );
            
            console.log('✅ Transacción guardada exitosamente en el Ledger');
        } catch (error: any) {
            // Esto nos dirá el error REAL de Fabric (ej: "function not found" o "endorsement failure")
            console.error('❌ Error detallado de Fabric Gateway:');
            if (error.details && error.details.length > 0) {
                console.error(`📝 Detalle: ${error.details[0].message}`);
            } else {
                console.error(error);
            }
            throw error; // Re-lanzamos para que el server.ts lo capture
        }
    }

    public async getAllTelemetry(): Promise<string> {
        if (!this.contract) throw new Error('Contrato no inicializado');

        console.log('🔍 Consultando Ledger...');
        const resultBytes = await this.contract.evaluateTransaction('GetAllTelemetry');
        
        const resultString = new TextDecoder().decode(resultBytes);
        return resultString;
    }

    // Nueva función para filtrar por DID
    public async getTelemetryByDid(droneDid: string): Promise<string> {
        if (!this.contract) throw new Error('Contrato no inicializado');

        console.log(`🔍 Buscando historial para: ${droneDid}`);
        
        // Llamamos a la función "QueryTelemetryByDid" que creamos en el contrato
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
}