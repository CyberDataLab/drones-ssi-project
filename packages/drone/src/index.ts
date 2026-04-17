import * as fs from "fs";
import { createSSIAgent } from "@tfm/shared";
import { config } from "./config/env";
import { createDocumentLoader } from "./core/offline-context";
import { startExpressServer, registerInDirectory, getLocalIP } from "./network/server";
import { startUDPRadar } from "./network/radar";
import { startTelemetryLoop, startP2PTelemetryLoop } from "./services/telemetry";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
    console.log("🚁 Starting Modular Drone OS...");

    if (!fs.existsSync(config.CONFIG_FILE) || !fs.existsSync(config.LOCAL_LICENSE_FILE)) {
        console.error("❌ ERROR: Setup required. Run provision script first.");
        process.exit(1);
    }

    const serverConfig = JSON.parse(fs.readFileSync(config.CONFIG_FILE, "utf-8"));
    console.log(`📡 Detected local IP: ${getLocalIP()}`);

    try {
        const agent = await createSSIAgent(config.DB_FILE, config.SECRET_KEY);
        const identifiers = await agent.didManagerFind();
        if (identifiers.length === 0) throw new Error("⛔ The drone has no DID.");

        const droneDID = identifiers[0].did;

        // Setup Document Loader for offline ZKP
        const documentLoader = createDocumentLoader(agent);

        // Read and decrypt license (Legacy SQLite behavior - we will upgrade this to RAM next)
        const encryptedBlob = fs.readFileSync(config.LOCAL_LICENSE_FILE, 'utf-8');
        const unpacked = await agent.unpackDIDCommMessage({ message: encryptedBlob });
        const myBbsCredential = unpacked.message.body.credential;
        console.log(`🔓 License decrypted in memory for DID: ${droneDID}`);

        // --- BOOT SYSTEMS ---
        startExpressServer(agent, droneDID, myBbsCredential, documentLoader);
        startUDPRadar(myBbsCredential, documentLoader);
        registerInDirectory(agent, droneDID, documentLoader);
        startTelemetryLoop(agent, droneDID, serverConfig.serverDid, myBbsCredential, documentLoader);
        startP2PTelemetryLoop(agent, droneDID);

    } catch (error) {
        console.error("❌ Error: ", error);
    }
}

main();