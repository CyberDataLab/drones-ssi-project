import * as path from "path";

export const config = {
    SECRET_KEY: "29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c",
    DB_FILE: "drone-database.sqlite",
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