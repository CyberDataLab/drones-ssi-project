// Core interfaces
import { createAgent, IDIDManager, IResolver, IDataStore, IKeyManager, IEventListener, IMessageHandler, IDataStoreORM, IAgentOptions, TAgent } from '@veramo/core'

// Core identity manager plugin
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager'

// Peer did identity provider
import { getResolver as getDidPeerResolver, PeerDIDProvider } from '@veramo/did-provider-peer'

// Core key manager plugin
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager'

import { DataStoreJson } from '@veramo/data-store-json'

// Custom key management system for RN
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local'

// W3C Verifiable Credential plugin
import { CredentialPlugin } from '@veramo/credential-w3c'

// Custom resolvers
import { DIDResolverPlugin } from '@veramo/did-resolver'

// Storage plugin using TypeOrm
import { Entities as DataStoreEntities, migrations as dataStoreMigrations,
} from '@veramo/data-store'

import { CoordinateMediationV3MediatorMessageHandler, DIDComm, DIDCommMessageHandler, IDIDComm, PickupMediatorMessageHandler, RoutingMessageHandler } from '@veramo/did-comm'

import { MessageHandler } from '@veramo/message-handler'

// TypeORM is installed with `@veramo/data-store`
import { DataSource } from 'typeorm'

import { IMediationManager, MediationManagerPlugin, MediationResponse, PreMediationRequestPolicy, RequesterDid } from '@veramo/mediation-manager'
import { KeyValueStore, kvStoreMigrations, Entities as KVStoreEntities } from '@veramo/kv-store'



const DATABASE_FILE = 'database.sqlite'
// IMPORTANTE!!!
// Hay que buscar una forma de generar la clave de forma segura y que no se pueda obtener 
// si el cloud es comprometido
const KMS_SECRET_KEY = 'bd569a12511f80eb8c4eafd3fc5643c9b7945dcb8ab2e3178fe9b99bd93826bc' // 32 bytes hex

const dbConnection = new DataSource({
  type: 'sqlite',
  database: DATABASE_FILE,
  synchronize: false,
  migrations: dataStoreMigrations.concat(kvStoreMigrations),
  migrationsRun: true,
  logging: ['error', 'info', 'warn'],
  entities: (KVStoreEntities as any).concat(DataStoreEntities),
}).initialize()

const DIDCommEventSniffer: IEventListener = {
    eventTypes: ['DIDCommV2Message-sent', 'DIDCommV2Message-received',
    'DIDCommV2Message-forwardMessageQueued', 'DIDCommV2Message-forwardMessageDequeued',],
        onEvent: (event:any) => new Promise<void>(()=> {
            console.log(event)
        }),
}

// minimum set of plugins for users
type UserAgentPlugins = IResolver & IKeyManager & IDIDManager & IMessageHandler & IDIDComm

// minimum set of plugins for mediator
type MediatorPlugins = UserAgentPlugins & IMediationManager & IDataStoreORM & IDataStore

const defaultKms = 'local'

function createMediatorAgent(options?: IAgentOptions): TAgent<MediatorPlugins> {
    
    let memoryJsonStore = { notifyUpdate: () => Promise.resolve() }

    let policyStore = new KeyValueStore<PreMediationRequestPolicy>({
        namespace: 'mediation_policy',
        store: new Map<string, PreMediationRequestPolicy>(),
    })

    let mediationStore = new KeyValueStore<MediationResponse>({
        namespace: 'mediation_response',
        store: new Map<string, MediationResponse>(),
    })

    let recipientDidStore = new KeyValueStore<RequesterDid>({
        namespace: 'recipient_did',
        store: new Map<string, RequesterDid>(),
    })

    return createAgent<MediatorPlugins>({
        ... options,
        plugins: [
            new DIDResolverPlugin({
                ...getDidPeerResolver(),
            }),
            new KeyManager({
                store: new MemoryKeyStore(),
                kms: {
                    [defaultKms]: new KeyManagementSystem(
                        new MemoryPrivateKeyStore(),
                    ),
                },
            }),
            new DIDManager({
                store: new MemoryDIDStore(),
                defaultProvider: 'did:peer',
                providers: {
                    'did:peer': new PeerDIDProvider({ defaultKms}),
                },
            }),
            new DataStoreJson(memoryJsonStore),
            new MessageHandler({
                messageHandlers: [
                    new DIDCommMessageHandler(),
                    new CoordinateMediationV3MediatorMessageHandler(),
                    new RoutingMessageHandler(),
                    new PickupMediatorMessageHandler(),
                ],
            }),
            new DIDComm(),
            // @ts-ignore
            new MediationManagerPlugin(true, policyStore, mediationStore, recipientDidStore),
            ...(options?.plugins || []),
            DIDCommEventSniffer,
        ],
    })
}

export const agent = createMediatorAgent();