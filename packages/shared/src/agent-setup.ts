import { createAgent, IResolver, IDataStore, IDIDManager, IKeyManager, ICredentialPlugin, IMessageHandler, TAgent as GenericAgent } from '@veramo/core'
import { DIDManager } from '@veramo/did-manager'
import { EthrDIDProvider } from '@veramo/did-provider-ethr'
import { WebDIDProvider } from '@veramo/did-provider-web'
import { KeyDIDProvider } from '@veramo/did-provider-key'
import { KeyManager } from '@veramo/key-manager'
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local'
import { DIDResolverPlugin } from '@veramo/did-resolver'
import { Resolver } from 'did-resolver'
import { getResolver as ethrDidResolver } from 'ethr-did-resolver'
import { getResolver as webDidResolver } from 'web-did-resolver'
import { getResolver as keyDidResolver } from 'key-did-resolver'
import { MessageHandler } from '@veramo/message-handler'
import { DIDCommMessageHandler, DIDComm, IDIDComm } from '@veramo/did-comm'

// 1. CORRECCIÓN: Importamos DataStoreORM y su interfaz IDataStoreORM
import { Entities, KeyStore, DIDStore, PrivateKeyStore, DataStore, DataStoreORM, IDataStoreORM, migrations } from '@veramo/data-store' 
import { CredentialPlugin } from '@veramo/credential-w3c'
import { DataSource } from 'typeorm'

// 2. CORRECCIÓN: Añadimos IDataStoreORM al tipo del agente
export type TAgent = GenericAgent<IDIDManager & IKeyManager & IDataStore & IResolver & ICredentialPlugin & IMessageHandler & IDIDComm & IDataStoreORM>

export async function createSSIAgent(dbName: string, secretKey: string): Promise<TAgent> {
  const dbConnection = new DataSource({
    type: 'sqlite',
    database: dbName,
    synchronize: false,
    migrationsRun: true,
    logging: false,
    entities: Entities,
    migrations: migrations,
  })

  const agent = createAgent<TAgent>({
    plugins: [
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(secretKey))),
        },
      }),
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:key',
        providers: {
          'did:ethr:goerli': new EthrDIDProvider({
            defaultKms: 'local',
            network: 'goerli',
            rpcUrl: 'https://rpc.ankr.com/eth_goerli', 
          }),
          'did:web': new WebDIDProvider({
            defaultKms: 'local',
          }),
          'did:key': new KeyDIDProvider({
            defaultKms: 'local',
          }),
        },
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...ethrDidResolver({ infuraProjectId: 'b0e00ec6063b49989b6f3ba096eb28f5' }),
          ...webDidResolver(),
          ...keyDidResolver(),
        }),
      }),
      
      // Plugin de Escritura
      new DataStore(dbConnection),
      
      // 3. CORRECCIÓN: Plugin de Lectura (ORM)
      new DataStoreORM(dbConnection),

      new CredentialPlugin(),
      new DIDComm(), 
      new MessageHandler({
        messageHandlers: [
          new DIDCommMessageHandler(),
        ],
      }),
    ],
  })
  return agent
}