import { config } from "../config/env";
import { droneState } from "../core/state";
import { registerInDirectory } from "../network/server";
import * as https from "https";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
export let p2pTelemetryCache: any[] = [];


/**
 * Adds a signed Verifiable Credential received from a peer into the local cache.
 */
export function addP2PTelemetryToCache(signedPeerTelemetry: any) {
    p2pTelemetryCache.push(signedPeerTelemetry);
    console.log(`📥 [P2P Cache] Stored telemetry from peer. Total items in cache: ${p2pTelemetryCache.length}`);
}

/**
 * Takes raw telemetry data and signs it using the drone's DID, creating a Verifiable Credential.
 */
async function signTelemetryAsVC(agent: any, droneDID: string, rawData: any, license: any): Promise<any> {
    try {
        const vc = await agent.createVerifiableCredential({
            credential: {
                issuer: { id: droneDID },
                issuanceDate: new Date().toISOString(),
                type: ['VerifiableCredential', 'DroneTelemetryCredential'],
                credentialSubject: {
                    id: droneDID, // The drone that generated the data
                    telemetry: rawData,
                    droneLicense: license // We attach the BBS+ license to prove authorization
                }
            },
            proofFormat: 'jwt',
        });
        return vc;
    } catch (error) {
        console.error("❌ Error signing telemetry VC:", error);
        throw error;
    }
}


export function startTelemetryLoop(agent: any, droneDID: string, serverDID: string, myBbsCredential: any, documentLoader: any) {
    setInterval(async () => {
        droneState.simBattery = Math.max(0, droneState.simBattery - 0.2);
        droneState.simAltitude = droneState.simAltitude + (Math.random() * 4 - 2);

        const metric = {
            battery: parseFloat(droneState.simBattery.toFixed(1)),
            altitude: parseFloat(droneState.simAltitude.toFixed(1)),
            temperature: parseFloat((35 + Math.random()).toFixed(1)),
            timestamp: new Date().toISOString(),
            verifiableCredential: [myBbsCredential],
        };
        const signedMetricVC = await signTelemetryAsVC(agent, droneDID, metric, myBbsCredential);
        droneState.telemetryBuffer.push(signedMetricVC);

        if (droneState.serverLicenseValidUntil && new Date() > droneState.serverLicenseValidUntil) {
            console.log(`\n🚨 ALERT: Server license EXPIRED at ${droneState.serverLicenseValidUntil.toLocaleString()}!`);
            droneState.isConnectedToServer = false;
            droneState.serverLicenseValidUntil = null;
            registerInDirectory(agent, droneDID, documentLoader);
            return;
        }

        if (!droneState.isConnectedToServer) return;
        if (droneState.telemetryBuffer.length === 0 || droneState.isSendingTelemetry) return;

        droneState.isSendingTelemetry = true;

        try {
            while (droneState.telemetryBuffer.length > 0) {
                const item = droneState.telemetryBuffer[0];

                const relayedDataToSync = [...p2pTelemetryCache];

                const combinedPayload = {
                    ownTelemetry: item,
                    relayedTelemetry: relayedDataToSync
                };

                const message = {
                    id: "msg-" + Date.now(),
                    type: "https://didcomm.org/drone-metrics/1.0/update",
                    from: droneDID,
                    to: [serverDID],
                    body: combinedPayload,
                };

                const packedServer = await agent.packDIDCommMessage({ packing: "authcrypt", message });

                console.log(`📡 Sending telemetry to server: Altitude ${metric.altitude}m, Battery ${metric.battery}%...`);

                const response = await fetch(`https://${config.SERVER_IP}:3000/messaging`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: packedServer.message,
                    agent: httpsAgent,
                } as any);

                if (response.ok) {
                    droneState.telemetryBuffer.shift();
                    // Remove the successfully sent relayed data from the P2P cache
                    p2pTelemetryCache = p2pTelemetryCache.filter(vc => !relayedDataToSync.includes(vc));
                    console.log(`✅ Telemetry sent (Alt:${metric.altitude}m, Bat:${metric.battery}%). Remaining buffer: ${droneState.telemetryBuffer.length}`);

                } else {
                    throw new Error("Failed to send telemetry: " + response.statusText);
                }
            }
        } catch (e) {
            console.error(`❌ Error sending telemetry, Server disconnected. Will retry in next cycle: ${e}`);
            droneState.isConnectedToServer = false;
            console.log(`📦 Telemetry buffer size: ${droneState.telemetryBuffer.length}`);
            registerInDirectory(agent, droneDID, documentLoader);
        } finally {
            droneState.isSendingTelemetry = false;
        }
    }, config.RETRY_TELEMETRY_INTERVAL);
}

export function startP2PTelemetryLoop(agent: any, droneDID: string) {
    setInterval(async () => {
        let hasAuthenticatedPeers = false;
        for (const peer of droneState.knownPeers.values()) {
            if (peer.status === "fully_authenticated") hasAuthenticatedPeers = true;
        }

        if (!hasAuthenticatedPeers) return;

        const currentFlightData = {
            altitude: parseFloat(droneState.simAltitude.toFixed(1)),
            battery: parseFloat(droneState.simBattery.toFixed(1)),
            timestamp: new Date().toISOString()
        };

        // We sign our data before sending it to our peers, so they can prove we sent it.
        const signedP2PData = await signTelemetryAsVC(agent, droneDID, currentFlightData, null);

        for (const [peerId, peer] of droneState.knownPeers.entries()) {
            if (peer.status === "fully_authenticated" && peer.did) {
                try {
                    const p2pMessage = {
                        id: 'p2p-msg-' + Date.now(),
                        type: 'https://didcomm.org/drone-p2p/1.0/telemetry',
                        from: droneDID,
                        to: [peer.did],
                        body: signedP2PData
                    };

                    const packedP2P = await agent.packDIDCommMessage({ packing: 'authcrypt', message: p2pMessage });

                    console.log(`📡 Sending P2P telemetry to ${peerId}: Altitude ${currentFlightData.altitude}m, Battery ${currentFlightData.battery}%...`);

                    fetch(`http://${peer.ip}:${peer.port}/messaging`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: packedP2P.message
                    }).catch(e => {
                        // If there's an error sending to this peer, we log it but don't mark them as disconnected immediately, since it could be a transient network issue. We'll find out in the next cycle if they're still reachable.
                        console.error(`❌ Error sending P2P telemetry to ${peerId}: ${e}`);
                        console.log(`⚠️ Will check peer ${peerId} connectivity in the next cycle...`);
                    });
                } catch (e) {
                    console.error(`❌ Error P2P telemetry for ${peerId}: ${e}`);
                }
            }
        }
    }, config.RETRY_TELEMETRY_INTERVAL_P2P);
}