import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';

// --- CONFIGURACIÓN DE RUTAS (Ajustadas a tu VM) ---
// Asumimos que la estructura es:
// /home/usuario/tfm-ssi/
//    ├── packages/server
//    └── fabric-network/fabric-samples/test-network

const mspId = 'Org1MSP';
const cryptoPath = path.resolve(__dirname, '../../../fabric-network/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/keystore');
const certPath = path.resolve(cryptoPath, 'users/Admin@org1.example.com/msp/signcerts/cert.pem');
const tlsCertPath = path.resolve(cryptoPath, 'peers/peer0.org1.example.com/tls/ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

const channelName = 'mychannel';
const chaincodeName = 'basic'; // El contrato en GO se llama 'basic'

export class BlockchainService {
    private contract: Contract | undefined;
    private client: grpc.Client | undefined;
    private gateway: any | undefined;

    constructor() {
        console.log('🔗 Inicializando servicio Blockchain...');
    }

    // 1. CONEXIÓN A LA RED
    public async connect() {
        try {
            // Cargar certificado TLS raíz
            const rootCert = await fs.promises.readFile(tlsCertPath);
            const tlsCredentials = grpc.credentials.createSsl(rootCert);

            // Crear cliente gRPC
            this.client = new grpc.Client(peerEndpoint, tlsCredentials, {
                'grpc.ssl_target_name_override': peerHostAlias,
            });

            // Cargar identidad (Certificado y Clave Privada)
            const id = await this.newIdentity();
            const signer = await this.newSigner();

            // Conectar el Gateway
            this.gateway = connect({
                client: this.client,
                identity: id,
                signer: signer,
                // Opciones para asegurar que escucha eventos
                evaluateOptions: () => { return { deadline: Date.now() + 5000 }; },
                endorseOptions: () => { return { deadline: Date.now() + 15000 }; },
                submitOptions: () => { return { deadline: Date.now() + 5000 }; },
                commitStatusOptions: () => { return { deadline: Date.now() + 60000 }; },
            });

            // Obtener el canal y el contrato
            const network = this.gateway.getNetwork(channelName);
            this.contract = network.getContract(chaincodeName);

            console.log('✅ Conexión establecida con Hyperledger Fabric');

        } catch (error) {
            console.error('❌ Error conectando a Fabric:', error);
            throw error;
        }
    }

    // 2. ESCRIBIR DATOS (Submit Transaction)
    // Usamos los campos del ejemplo 'basic' (AssetTransfer) por ahora
    public async createAsset(id: string, color: string, size: number, owner: string, value: number) {
        if (!this.contract) throw new Error('Contrato no inicializado');

        console.log(`⚡ Enviando transacción: CreateAsset(${id})`);
        
        await this.contract.submitTransaction(
            'CreateAsset',
            id,
            color,
            String(size),
            owner,
            String(value)
        );
        
        console.log('💾 Transacción guardada en el Ledger');
    }

    // 3. LEER DATOS (Evaluate Transaction)
    public async getAllAssets(): Promise<string> {
        if (!this.contract) throw new Error('Contrato no inicializado');

        console.log('🔍 Consultando Ledger...');
        const resultBytes = await this.contract.evaluateTransaction('GetAllAssets');
        
        const resultString = new TextDecoder().decode(resultBytes);
        return resultString;
    }

    // --- FUNCIONES AUXILIARES (Criptografía) ---

    private async newIdentity(): Promise<Identity> {
        const credentials = await fs.promises.readFile(certPath);
        return { mspId, credentials };
    }

    private async newSigner(): Promise<Signer> {
        // Buscamos la clave privada (el nombre del archivo cambia siempre)
        const files = await fs.promises.readdir(keyDirectoryPath);
        const keyPath = path.resolve(keyDirectoryPath, files[0]);
        const privateKeyPem = await fs.promises.readFile(keyPath);
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        return signers.newPrivateKeySigner(privateKey);
    }
}