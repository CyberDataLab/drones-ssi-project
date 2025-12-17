// Agent implementation entry point
// Create and manage DIDs
// Send/Receive messages
// Save data locally (SQLite or KV)


// import * as dotenv from 'dotenv'
// dotenv.config()

// Core Veramo Framework
import { createAgent } from '@veramo/core'
import type { IDIDManager, IKeyManager, IMessageHandler, IResolver } from '@veramo/core'

// Core identity manager plugin. This allows you to create and manage DIDs by orchestrating different DID provider packages.
// This implements `IDIDManager`
import { DIDManager } from '@veramo/did-manager'
import { KeyManager } from '@veramo/key-manager'
import { DIDResolverPlugin } from '@veramo/did-resolver'
import { Resolver } from 'did-resolver'
import { getResolver as webDidResolver } from 'web-did-resolver'
import { getResolver as keyDidResolver } from 'key-did-resolver'
import { WebDIDProvider } from '@veramo/did-provider-web'

// This plugin allows us to create and manage `did:key` DIDs. (used by DIDManager)
//import { getResolver as getDidPeerResolver, PeerDIDProvider } from '@veramo/did-provider-peer'

// Storage plugin using TypeORM to link to a database
import { Entities, KeyStore, DIDStore, migrations, PrivateKeyStore, DataStore, DataStoreORM } from '@veramo/data-store'
// A key management system that uses a local database to store keys (used by KeyManager)
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local'
// TypeORM is installed with '@veramo/data-store'
import { DataSource } from 'typeorm'

import { DIDComm, DIDCommMessageHandler } from '@veramo/did-comm'
import { MessageHandler } from '@veramo/message-handler'



const DATABASE_FILE = 'databse.sqlite'

// Hay que buscar una forma de generar la clave de forma segura y que no se pueda obtener 
// si el dron es comprometido
const DB_KEY = 'ef543c76ba0804e4ea0c7ff28579757095c1bafddc1de42fd0cf4f226f629954'

const dbConnection = new DataSource({
    type: 'sqlite',
    database: DATABASE_FILE,
    entities: Entities,
    migrations: migrations,
    synchronize: false,
    migrationsRun: true,
    logging: ['error', 'info', 'warn']
})

export const initializeDatabase = async () => {
    if (!dbConnection.isInitialized) {
        await dbConnection.initialize()
    }
    return dbConnection
}

const defaultKms = 'local'

const didResolver = new Resolver({
    ...keyDidResolver(),
    ...webDidResolver(),
})





export const agent = createAgent<IDIDManager & IKeyManager & IMessageHandler & IResolver>({
    plugins: [
        
        new KeyManager({
            store: new KeyStore(dbConnection),
            kms: {
                [defaultKms]: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(DB_KEY))),
            },
        }),
        new DIDManager({
            store: new DIDStore(dbConnection),
            defaultProvider: 'did:web',
            providers: {
                'did:web': new WebDIDProvider({
                    defaultKms,
                }),
            },
        }),
        new DIDResolverPlugin({
            resolver: didResolver,
        }),
        new MessageHandler({
            messageHandlers: [
                new DIDCommMessageHandler(),
                // Aquí añadiremos handlers específicos (métricas, imágenes, etc.)
            ]
        }),
        new DataStore(dbConnection),
        new DataStoreORM(dbConnection),
        new DIDComm(),
    ],
})
