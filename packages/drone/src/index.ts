import { createSSIAgent } from "@tfm/shared";
import { config } from "./config/env";
import { createDocumentLoader } from "./core/offline-context";
import { runProvisioning } from "./services/provisioning";
import { startExpressServer, registerInDirectory, getLocalIP } from "./network/server";
import { startUDPRadar } from "./network/radar";
import { startTelemetryLoop, startP2PTelemetryLoop } from "./services/telemetry";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
    console.log("🚁 Starting Modular Drone OS...");
    console.log(`📡 Detected local IP: ${getLocalIP()}`);

    try {
        // :memory: is used to bypass the hard drive entirely
        const agent = await createSSIAgent(':memory:', config.DB_ENCRYPTION_KEY);
        const { droneDID, serverDid, myBbsCredential } = await runProvisioning(agent);
        const documentLoader = createDocumentLoader(agent);

        console.log('\n🚀 [FLY MODE] All systems Go! Starting operational systems...');

        startExpressServer(agent, droneDID, myBbsCredential, documentLoader);
        startUDPRadar(agent, myBbsCredential, documentLoader);
        registerInDirectory(agent, droneDID, documentLoader);
        startTelemetryLoop(agent, droneDID, serverDid, myBbsCredential, documentLoader);
        startP2PTelemetryLoop(agent, droneDID);

    } catch (error) {
        console.error("❌ Fatal System Error:", error);
        process.exit(1);
    }
}

main();