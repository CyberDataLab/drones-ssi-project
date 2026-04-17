import * as path from "path";
import * as crypto from "crypto";


const rawSeed = process.env.DRONE_SEED || "29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c"

const privateKeyHex = crypto.createHash('sha256').update(rawSeed).digest('hex');
const dbEncryptionKey = crypto.createHash('sha256').update(rawSeed + 'db_secret').digest('hex');

export const config = {
    PRIVATE_KEY_HEX: privateKeyHex,
    DB_ENCRYPTION_KEY: dbEncryptionKey,
    CONFIG_FILE: path.join(__dirname, "../../drone-config.json"),
    LOCAL_LICENSE_FILE: path.join(__dirname, "../../license/drone-license.jwe"),
    AUTHORITY_PUB_KEY: path.join(__dirname, "../../authority_public_key/authority-public-key.json"),
    P2P_PORT: parseInt(process.env.P2P_PORT || "40000"),
    UDP_DISCOVERY_PORT: 41234,
    SERVER_IP: "192.168.56.109",
    RETRY_TELEMETRY_INTERVAL: 5000,
    RETRY_TELEMETRY_INTERVAL_P2P: 2000,
    RETRY_REGISTER_INTERVAL: 5000,
    BROADCAST_BEACON_INTERVAL: 5000,
};