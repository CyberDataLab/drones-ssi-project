import * as path from 'path';

export const CONFIG = {
    PORT: 3000,
    JWT_SECRET: 'secret-key-for-authentication', // Change in prod
    SERVER_SECRET_KEY: '55555555cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8555',
    DB_FILE: 'server-database.sqlite',

    // File paths
    USER_FILE: path.join(__dirname, '../../users.json'),
    LOCAL_LICENSE_FILE: path.join(__dirname, '../../license/server-license.jwe'),
    PUB_KEY_AUTHORITY: path.join(__dirname, '../../authority_public_key/authority-public-key.json'),
    DATASET_FILE: path.join(__dirname, '../../drones-dataset.csv'),
    SSL_KEY: path.join(__dirname, '../../certs/server.key'),
    SSL_CERT: path.join(__dirname, '../../certs/server.cert'),
    PUBLIC_DIR: path.join(__dirname, '../../public')
};