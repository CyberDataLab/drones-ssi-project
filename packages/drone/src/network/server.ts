import express from "express";
import * as os from "os";
import * as https from "https";
import { config } from "../config/env";
import { droneState } from "../core/state";
// @ts-ignore
import { verify, purposes } from "jsonld-signatures";
import { BbsBlsSignature2020, BbsBlsSignatureProof2020 } from "@mattrglobal/jsonld-signatures-bbs";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const info of interfaces[name] || []) {
            if (info.family === "IPv4" && !info.internal) return info.address;
        }
    }
    return "127.0.0.1";
}

export async function registerInDirectory(agent: any, droneDID: string, documentLoader: any) {
    const myEndpoint = `http://${getLocalIP()}:${config.P2P_PORT}/messaging`;
    try {

        console.log(`\n🔄 Attempting to register and authenticate Server at ${config.SERVER_IP}...`);

        const response = await fetch(`https://${config.SERVER_IP}:3000/directory`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "register",
                did: droneDID,
                endpoint: myEndpoint
            }),
            agent: httpsAgent,
        } as any);

        if (response.ok) {
            const responseData = await response.json();
            if (!responseData.serverCredential) throw new Error("No server license.");

            console.log("🔍 Verifying Server's Operation License...");

            const verificationResult = await verify(responseData.serverCredential, {
                suite: new BbsBlsSignature2020(),
                purpose: new purposes.AssertionProofPurpose(),
                documentLoader,
            });

            if (!verificationResult.verified) throw new Error("Invalid server signature.");
            const expirationString = responseData.serverCredential.expirationDate;
            if (!expirationString) {
                throw new Error("Server license is missing an expiration date attribute.");
            }
            droneState.serverLicenseValidUntil = new Date(expirationString);

            if (new Date() > droneState.serverLicenseValidUntil) throw new Error(`Server license expired on ${droneState.serverLicenseValidUntil.toLocaleString()}!`);

            console.log(`✅ Registered in directory: ${myEndpoint}.  Server license valid until ${droneState.serverLicenseValidUntil.toLocaleString()}.`);
            droneState.isConnectedToServer = true;
        } else {
            throw new Error("Failed directory registration");
        }
    } catch (e: any) {
        droneState.isConnectedToServer = false;
        droneState.serverLicenseValidUntil = null;
        console.log(`\n❌ Error registering in directory, will retry in ${config.RETRY_REGISTER_INTERVAL} ms.... Error: ${e.message}`);

        setTimeout(() => registerInDirectory(agent, droneDID, documentLoader), config.RETRY_REGISTER_INTERVAL);
    }
}

export function startExpressServer(agent: any, droneDID: string, myBbsCredential: any, documentLoader: any) {
    const app = express();
    app.use(express.json());

    app.post("/messaging", async (req, res) => {
        const message = req.body;

        // --- DIDCOMM ENCRYPTED ---
        if (message.ciphertext || message.protected) {
            try {
                const rawMessageString = typeof message === 'string' ? message : JSON.stringify(message);
                const unpacked = await agent.unpackDIDCommMessage({ message: rawMessageString });
                const decryptedMsg = unpacked.message;

                if (decryptedMsg.type === 'https://didcomm.org/drone-p2p/1.0/telemetry') {
                    const { altitude, battery } = decryptedMsg.body;
                    console.log(`\n🛡️ [SECURE P2P] Telemetry from ${decryptedMsg.from}`);
                    console.log(`   ➜ Peer Altitude: ${altitude}m | Battery: ${battery}%`);
                    return res.status(200).send('Secure Telemetry Processed');
                }

                if (decryptedMsg.type === "https://didcomm.org/drone-p2p/1.0/identity-reveal") {

                    console.log(`👤 Received identity reveal from ${message.from}`);

                    const verificationResult = await verify(decryptedMsg.body.credential, {
                        suite: new BbsBlsSignature2020(),
                        purpose: new purposes.AssertionProofPurpose(),
                        documentLoader
                    });

                    if (verificationResult.verified) {
                        const senderIp = req.ip?.includes("::ffff:") ? req.ip.split("::ffff:")[1] : (req.ip || "127.0.0.1");
                        const peerId = `${senderIp}:${decryptedMsg.body.replyPort}`;
                        droneState.knownPeers.set(peerId, {
                            ip: senderIp,
                            port: decryptedMsg.body.replyPort,
                            did: decryptedMsg.from,
                            status: "fully_authenticated"
                        });
                        console.log(`🤝 Mutual Auth Complete with ${decryptedMsg.from}!`);
                        return res.status(200).send('Identity Accepted');
                    }
                }
            } catch (e) {
                console.error(`❌ Error unpacking/authenticating message: ${e}`);
                return res.status(400).send('Invalid encrypted message');
            }
        }

        // --- PLAIN TEXT ZKP CHALLENGE ---
        if (message.type === "https://didcomm.org/drone-metrics/1.0/zkp-challenge") {
            try {
                const verificationResult = await verify(message.body.zkp, {
                    suite: new BbsBlsSignatureProof2020(),
                    purpose: new purposes.AssertionProofPurpose(),
                    documentLoader
                });

                if (verificationResult.verified) {
                    const senderIp = req.ip?.includes("::ffff:") ? req.ip.split("::ffff:")[1] : (req.ip || "127.0.0.1");
                    const peerId = `${senderIp}:${message.body.replyPort}`;
                    droneState.knownPeers.set(peerId, {
                        ip: senderIp,
                        port: message.body.replyPort,
                        status: "zkp_verified"
                    });

                    const identityMessage = {
                        type: "https://didcomm.org/drone-p2p/1.0/identity-reveal",
                        from: droneDID,
                        body: {
                            credential: myBbsCredential,
                            replyPort: config.P2P_PORT
                        },
                    };

                    const packedIdentity = await agent.packDIDCommMessage({ packing: 'authcrypt', message: identityMessage });
                    fetch(`http://${senderIp}:${message.body.replyPort}/messaging`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: packedIdentity.message,
                    }).catch(() => { });

                    return res.status(200).send("ZKP verified");
                }
            } catch (e) {
                return res.status(500).send("ZKP verification failed");
            }
        }

        res.status(400).send('Unsupported');
    });

    app.listen(config.P2P_PORT, "0.0.0.0", () => {
        console.log(`🚀 P2P Messaging endpoint listening on port ${config.P2P_PORT}`);
    });
}