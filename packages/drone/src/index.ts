import { createSSIAgent } from "@tfm/shared";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import express from "express";
import * as os from "os";
import { BbsBlsSignature2020, BbsBlsSignatureProof2020, deriveProof } from "@mattrglobal/jsonld-signatures-bbs";
// @ts-ignore
import { extendContextLoader, purposes, verify } from "jsonld-signatures";
import * as dgram from "dgram";
import { randomBytes } from "crypto";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // This is needed to allow self-signed certificates in development. DO NOT USE IN PRODUCTION.
let isConnectedToServer = false;
let telemetryBuffer: any[] = [];
let retryTelemetryInterval = 5000;
let retryRegisterInterval = 5000;

async function main() {
  console.log("🚁 Starting Drone Agent...");

  const SECRET_KEY = "29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c";
  const DB_FILE = "drone-database.sqlite";
  const CONFIG_FILE = path.join(__dirname, "../drone-config.json");
  const LOCAL_LICENSE_FILE = path.join(__dirname, "../license/drone-license.json",);

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error("❌ ERROR: Configuration file not found. Please run the setup script first.");
    process.exit(1);
  }

  if (!fs.existsSync(LOCAL_LICENSE_FILE)) {
    console.error("❌ ERROR: License file not found. Please run the setup script first.");
    process.exit(1);
  }

  function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const info of iface) {
          if (info.family === "IPv4" && !info.internal) {
            addresses.push(info.address);
          }
        }
      }
    }
    return addresses;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  const SERVER_DID = config.serverDid;
  const SERVER_IP = "192.168.56.109";
  const MY_IP = getLocalIP()[0];
  console.log(`📡 Detected local IP: ${MY_IP}`);

  const P2P_PORT = parseInt(process.env.P2P_PORT || "40000");

  try {
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY);

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const identifiers = await agent.didManagerFind();
    if (identifiers.length === 0) {
      console.error("⛔ ERROR: The drone has no DID.");
      process.exit(1);
    }

    const droneDID = identifiers[0].did;

    const myBbsCredential = JSON.parse(fs.readFileSync(LOCAL_LICENSE_FILE, "utf-8"));
    console.log(`📄 Loaded local license credential for DID: ${droneDID}`);
    console.log(`📄 BBS+ credential loaded`);

    async function registerInDirectory() {
      const myEndpoint = `http://${MY_IP}:${P2P_PORT}/messaging`;
      try {
        const response = await fetch(`https://${SERVER_IP}:3000/directory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            did: droneDID,
            endpoint: myEndpoint,
          }),
          agent: httpsAgent,
        } as any);

        if (response.ok) {
          console.log(`✅ Registered in directory: ${myEndpoint}`);
          isConnectedToServer = true;
        } else {
          throw new Error("Failed to register in directory: " + response.statusText);
        }
      } catch (e) {
        isConnectedToServer = false;
        console.log(`\n❌ Error registering in directory, will retry in ${retryRegisterInterval} ms...`);
        setTimeout(registerInDirectory, retryRegisterInterval);
      }
    }

    let simBattery = 100;
    let simAltitude = 50;
    let isSendingTelemetry = false;

    function startTelemetryLoop() {
      setInterval(async () => {
        simBattery = Math.max(0, simBattery - 0.2);
        simAltitude = simAltitude + (Math.random() * 4 - 2);

        const metric = {
          battery: parseFloat(simBattery.toFixed(1)),
          altitude: parseFloat(simAltitude.toFixed(1)),
          temperature: parseFloat((35 + Math.random()).toFixed(1)),
          timestamp: new Date().toISOString(),
          verifiableCredential: [myBbsCredential],
        };

        telemetryBuffer.push(metric);

        if (!isConnectedToServer) {
          console.log(`\n⚠️ Not connected to server, telemetry buffered: ${telemetryBuffer.length} items`);
          return;
        }

        if (!isConnectedToServer || telemetryBuffer.length === 0 || isSendingTelemetry) return;

        isSendingTelemetry = true;

        try {
          if (telemetryBuffer.length > 1) {
            console.log(`📤 Sending ${telemetryBuffer.length} telemetry items`);
          }
          while (telemetryBuffer.length > 0) {
            const item = telemetryBuffer[0];

            const message = {
              id: "msg-" + Date.now() + Math.random(),
              type: "https://didcomm.org/drone-metrics/1.0/update",
              from: droneDID,
              to: [SERVER_DID],
              body: item,
            };
            const packedServer = await agent.packDIDCommMessage({
              packing: "authcrypt",
              message,
            });

            console.log(`📡 Sending telemetry to server: Altitude ${item.altitude}m, Battery ${item.battery}%...`);
            const response = await fetch(`https://${SERVER_IP}:3000/messaging`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: packedServer.message,
              agent: httpsAgent,
            } as any,
            );

            if (response.ok) {
              telemetryBuffer.shift();
              console.log(`✅ Telemetry sent (Alt:${item.altitude}m, Bat:${item.battery}%). Remaining buffer: ${telemetryBuffer.length}`);
            } else {
              throw new Error("Failed to send telemetry: " + response.statusText);
            }
          }
        } catch (e) {
          console.error(`❌ Error sending telemetry, Server disconnected. Will retry in next cycle: ${e}`);
          isConnectedToServer = false;

          console.log(`📦 Telemetry buffer size: ${telemetryBuffer.length}`);

          registerInDirectory();
        } finally {
          isSendingTelemetry = false;
        }
      }, retryTelemetryInterval);
    }

    const contextCache = new Map();

    // Preload important contexts to avoid network calls during critical operations like ZKP verification. This also allows us to inject custom contexts for the BBS+ suite and the drone license credential.
    contextCache.set("https://w3id.org/security/suites/jws-2020/v1", {
      contextUrl: null,
      documentUrl: "https://w3id.org/security/suites/jws-2020/v1",
      document: {
        "@context": {
          id: "@id",
          type: "@type",
          JsonWebSignature2020: {
            "@id": "https://w3id.org/security#JsonWebSignature2020",
            "@context": {
              "@protected": true,
              id: "@id",
              type: "@type",
              challenge: "https://w3id.org/security#challenge",
              created: {
                "@id": "http://purl.org/dc/terms/created",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              domain: "https://w3id.org/security#domain",
              expires: {
                "@id": "https://w3id.org/security#expiration",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              jws: "https://w3id.org/security#jws",
              nonce: "https://w3id.org/security#nonce",
              proofPurpose: {
                "@id": "https://w3id.org/security#proofPurpose",
                "@type": "@vocab",
                "@context": {
                  "@protected": true,
                  id: "@id",
                  type: "@type",
                  assertionMethod: {
                    "@id": "https://w3id.org/security#assertionMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                  authentication: {
                    "@id": "https://w3id.org/security#authenticationMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                },
              },
              proofValue: "https://w3id.org/security#proofValue",
              verificationMethod: {
                "@id": "https://w3id.org/security#verificationMethod",
                "@type": "@id",
              },
            },
          },
        },
      },
    });
    contextCache.set("https://w3id.org/security/bbs/v1", {
      contextUrl: null,
      documentUrl: "https://w3id.org/security/bbs/v1",
      document: {
        "@context": {
          id: "@id",
          type: "@type",
          BbsBlsSignature2020: {
            "@id": "https://w3id.org/security#BbsBlsSignature2020",
            "@context": {
              "@protected": true,
              id: "@id",
              type: "@type",
              challenge: "https://w3id.org/security#challenge",
              created: {
                "@id": "http://purl.org/dc/terms/created",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              domain: "https://w3id.org/security#domain",
              expires: {
                "@id": "https://w3id.org/security#expiration",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              nonce: "https://w3id.org/security#nonce",
              proofPurpose: {
                "@id": "https://w3id.org/security#proofPurpose",
                "@type": "@vocab",
                "@context": {
                  "@protected": true,
                  id: "@id",
                  type: "@type",
                  assertionMethod: {
                    "@id": "https://w3id.org/security#assertionMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                  authentication: {
                    "@id": "https://w3id.org/security#authenticationMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                },
              },
              proofValue: "https://w3id.org/security#proofValue",
              verificationMethod: {
                "@id": "https://w3id.org/security#verificationMethod",
                "@type": "@id",
              },
            },
          },
          BbsBlsSignatureProof2020: {
            "@id": "https://w3id.org/security#BbsBlsSignatureProof2020",
            "@context": {
              "@protected": true,
              id: "@id",
              type: "@type",
              challenge: "https://w3id.org/security#challenge",
              created: {
                "@id": "http://purl.org/dc/terms/created",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              domain: "https://w3id.org/security#domain",
              expires: {
                "@id": "https://w3id.org/security#expiration",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              nonce: "https://w3id.org/security#nonce",
              proofPurpose: {
                "@id": "https://w3id.org/security#proofPurpose",
                "@type": "@vocab",
                "@context": {
                  "@protected": true,
                  id: "@id",
                  type: "@type",
                  assertionMethod: {
                    "@id": "https://w3id.org/security#assertionMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                  authentication: {
                    "@id": "https://w3id.org/security#authenticationMethod",
                    "@type": "@id",
                    "@container": "@set",
                  },
                },
              },
              proofValue: "https://w3id.org/security#proofValue",
              verificationMethod: {
                "@id": "https://w3id.org/security#verificationMethod",
                "@type": "@id",
              },
            },
          },
          Bls12381G2Key2020: {
            "@id": "https://w3id.org/security#Bls12381G2Key2020",
            "@context": {
              "@protected": true,
              id: "@id",
              type: "@type",
              controller: {
                "@id": "https://w3id.org/security#controller",
                "@type": "@id",
              },
              revoked: {
                "@id": "https://w3id.org/security#revoked",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
              publicKeyBase58: "https://w3id.org/security#publicKeyBase58",
              privateKeyBase58: "https://w3id.org/security#privateKeyBase58",
            },
          },
        },
      },
    });

    const customLoader = async (url: string) => {
      if (contextCache.has(url)) return contextCache.get(url);

      if (url.startsWith("did:")) {
        const baseDid = url.split("#")[0];
        const resolution = (await agent.resolveDid({ didUrl: baseDid })) as any;

        const pubKeyPath = path.join(__dirname, "../authority_public_key/authority-public-key.json");
        if (fs.existsSync(pubKeyPath)) {
          const authKey = JSON.parse(fs.readFileSync(pubKeyPath, "utf-8"));

          const keyString = authKey.publicKeyBase58 || authKey.publicKey;


          const cleanKey = {
            type: "Bls12381G2Key2020",
            controller: baseDid,
            publicKeyBase58: keyString,
          };


          const keyId1 = `${baseDid}#bbs-key-1`;
          const keyId2 = `${baseDid}#bbs-key`;

          if (!resolution.didDocument.verificationMethod)
            resolution.didDocument.verificationMethod = [];
          if (!resolution.didDocument.assertionMethod)
            resolution.didDocument.assertionMethod = [];

          resolution.didDocument.verificationMethod =
            resolution.didDocument.verificationMethod.filter(
              (k: any) => k.id !== keyId1 && k.id !== keyId2,
            );

          resolution.didDocument.verificationMethod.push({
            ...cleanKey,
            id: keyId1,
          });
          resolution.didDocument.verificationMethod.push({
            ...cleanKey,
            id: keyId2,
          });

          resolution.didDocument.assertionMethod.push(keyId1);
          resolution.didDocument.assertionMethod.push(keyId2);
        }

        const result = {
          contextUrl: null,
          documentUrl: url,
          document: resolution.didDocument,
        };
        contextCache.set(url, result);
        return result;
      }

      const response = await fetch(url, {
        headers: { Accept: "application/ld+json, application/json" },
        redirect: "follow",
      });
      if (!response.ok)
        throw new Error(`Error HTTP ${response.status} en ${url}`);
      const result = {
        contextUrl: null,
        documentUrl: url,
        document: await response.json(),
      };
      contextCache.set(url, result);
      return result;
    };

    const documentLoader = extendContextLoader(customLoader);

    const UDP_DISCOVERY_PORT = 41234; // Static port so all drones speak/listen on the same channel
    const knownPeers = new Map<string, any>();

    async function deriveZkpPresentation(credential: any) {
      console.log("⚙️ [ZKP-DEBUG] Saneando credencial para el motor WASM...");

      const cred = JSON.parse(JSON.stringify(credential));

      if (Array.isArray(cred.proof)) cred.proof = cred.proof[0];

      if (typeof cred.proof.verificationMethod === "object") {
        cred.proof.verificationMethod = cred.proof.verificationMethod.id;
      }


      const revealDocument = {
        "@context": cred["@context"],
        type: ["VerifiableCredential", "DroneLicense"],
        "@explicit": true,
        credentialSubject: {
          "@explicit": true,
          type: ["DroneLicense"],
          authorizedArea: {}, // Reveal only the authorizedArea property, which is what the server needs to know for authorization. The rest of the properties (like drone ID) are kept hidden in the ZKP.
        },
      };

      const nonce = randomBytes(32);

      try {
        console.log("⚙️ [ZKP-DEBUG] Ejecutando deriveProof...");
        const zkp = await deriveProof(cred, revealDocument, {
          suite: new BbsBlsSignatureProof2020(),
          documentLoader: documentLoader,
          nonce: nonce,
        });
        return zkp;
      } catch (error: any) {
        console.error("🚨 [MATTR ERROR]:", error.message);
        console.log("DEBUG OBJ:", JSON.stringify(cred.proof, null, 2));
        throw error;
      }
    }

    async function initiateZkpChallenge(peerIp: string, peerPort: number) {
      console.log(`🔐 Initiating ZKP challenge with peer at ${peerIp}:${peerPort}`);

      try {
        const zkp = await deriveZkpPresentation(myBbsCredential);

        const ephemeralDid = `did:key:ephemeral-${Date.now()}`;

        const challengeMessage = {
          type: "https://didcomm.org/drone-metrics/1.0/zkp-challenge",
          from: ephemeralDid,
          body: {
            zkp: zkp,
            replyPort: P2P_PORT,
          },
        };

        // Since we don't know your DID yet, we can't use asymmetric encryption (authcrypt).
        // We send the JSON in plain text, but it's safe because the ZKP doesn't contain any sensitive data.
        const response = await fetch(`http://${peerIp}:${peerPort}/messaging`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(challengeMessage),
        });

        if (response.ok) {
          console.log(`✅ ZKP challenge sent to ${peerIp}:${peerPort}`);
        }
      } catch (e) {
        console.error(`❌ Error initiating ZKP challenge with ${peerIp}:${peerPort}: ${e}`);
      }
    }

    const app = express();
    app.use(express.json());

    app.post("/messaging", async (req, res) => {
      const message = req.body;

      if (message.type === "https://didcomm.org/drone-metrics/1.0/zkp-challenge") {
        console.log(`🔍 Received ZKP challenge from ${message.from}`);

        try {
          const verificationResult = await verify(message.body.zkp, {
            suite: new BbsBlsSignatureProof2020(),
            purpose: new purposes.AssertionProofPurpose(),
            documentLoader: documentLoader,
          });

          if (verificationResult.verified) {
            // console.log("\n====== 🔦 DUMP ZKP ======");
            // console.log(JSON.stringify(message.body.zkp, null, 2));
            // console.log("======================================\n");

            let authZone = "Unknown";
            const zkpData = message.body.zkp;

            if (zkpData["@graph"]) {
              const nodeWithArea = zkpData["@graph"].find(
                (node: any) =>
                  node.credentialSubject &&
                  node.credentialSubject.authorizedArea,
              );
              if (nodeWithArea) {
                authZone = nodeWithArea.credentialSubject.authorizedArea;
              }
            } else if (zkpData.credentialSubject) {
              const subject = Array.isArray(zkpData.credentialSubject)
                ? zkpData.credentialSubject[0]
                : zkpData.credentialSubject;
              authZone = subject?.authorizedArea || "Unknown";
            }

            console.log(`✅ ZKP verified! Peer is authorized for zone: ${authZone}`);

            const rawIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
            const senderIp = rawIp.includes("::ffff:")
              ? rawIp.split("::ffff:")[1]
              : rawIp;
            const peerId = `${senderIp === "127.0.0.1" ? "127.0.0.1" : senderIp}:${message.body.replyPort}`;

            knownPeers.set(peerId, {
              ip: senderIp,
              port: message.body.replyPort,
              status: "zkp_verified",
            });

            console.log(`👥 Peer ${peerId} added to known peers with authorized zone: ${authZone}`);

            const identityMessage = {
              type: "https://didcomm.org/drone-metrics/1.0/identity-reveal",
              from: droneDID,
              body: {
                credential: myBbsCredential,
                replyPort: P2P_PORT,
              },
            };

            fetch(`http://${senderIp}:${message.body.replyPort}/messaging`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(identityMessage),
            }).catch((e) => {
              console.error(
                `❌ Error sending identity reveal to ${peerId}: ${e}`,
              );
            });

            res.status(200).send("ZKP verified");
          } else {
            console.error(`❌ Invalid ZKP from ${message.from}`);
            res.status(403).send("Invalid ZKP");
          }
        } catch (e) {
          console.error(`❌ Error verifying ZKP from ${message.from}: ${e}`);
          res.status(500).send("ZKP verification failed");
        }
        return;
      }

      if (message.type === "https://didcomm.org/drone-metrics/1.0/identity-reveal") {
        console.log(`👤 Received identity reveal from ${message.from}`);

        try {
          const verificationResult = await verify(message.body.credential, {
            suite: new BbsBlsSignature2020(),
            purpose: new purposes.AssertionProofPurpose(),
            documentLoader: documentLoader,
          });

          if (verificationResult.verified) {
            console.log(`✅ Real License Verified! DID ${message.from} is authentic.`);
            const rawIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
            const senderIp = rawIp.includes("::ffff:")
              ? rawIp.split("::ffff:")[1]
              : rawIp;
            const peerId = `${senderIp === "127.0.0.1" ? "127.0.0.1" : senderIp}:${message.body.replyPort}`;

            const peerState = knownPeers.get(peerId);

            knownPeers.set(peerId, {
              ip: senderIp,
              port: message.body.replyPort,
              did: message.from,
              status: "fully_authenticated",
            });

            if (peerState && peerState.status === 'discovered') {
              console.log(`📤 Sending my real identity back to complete mutual authentication...`);
              const replyMessage = {
                type: 'https://didcomm.org/drone-p2p/1.0/identity-reveal',
                from: droneDID,
                body: {
                  credential: myBbsCredential,
                  replyPort: P2P_PORT
                }
              };
              fetch(`http://${senderIp}:${message.body.replyPort}/messaging`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(replyMessage)
              }).catch(e => console.error("Error replying with real identity:", e));
            }

            console.log(`🤝 Mutual Authentication Complete with ${message.from}!`);
            res.status(200).send('Identity Accepted');
          } else {
            console.error(`❌ Invalid Real License from ${message.from}`);
            res.status(403).send('Invalid License');
          }
        } catch (e) {
          console.error(`❌ Error verifying Real License:`, e);
          res.status(500).send('License verification failed');
        }
        return;
      }

      res.status(400).send('Unsupported message type');
    });

    app.listen(P2P_PORT, "0.0.0.0", () => {
      console.log(`🚀 Drone P2P messaging endpoint listening on port ${P2P_PORT}`);
    });

    function startUDPRadar() {
      const udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      udpSocket.on("listening", () => {
        udpSocket.setBroadcast(true);
        console.log(`📡 UDP Radar listening on port ${UDP_DISCOVERY_PORT}`);
      });

      udpSocket.on("message", (msg, rinfo) => {
        try {
          const message = JSON.parse(msg.toString());

          if (message.type === "HELLO_DRONE_NETWORK") {
            const peerId = `${rinfo.address}:${message.p2pPort}`;
            // const isMe = (rinfo.address === MY_IP || rinfo.address === '127.0.0.1') // REAL SCENARIO
            const isMe = message.p2pPort === P2P_PORT; // DEBUG: Used when testing in localhost with multiple drones, since they all have the same IP but different ports.

            if (!isMe && !knownPeers.has(peerId)) {
              console.log(`👋 Discovered peer drone at ${peerId}`);

              knownPeers.set(peerId, {
                ip: rinfo.address,
                port: message.p2pPort,
                status: "discovered",
              });

              initiateZkpChallenge(rinfo.address, message.p2pPort);
            }
          }
        } catch (e) { }
      });

      udpSocket.bind(UDP_DISCOVERY_PORT);

      setInterval(() => {
        const beaconMsg = JSON.stringify({
          type: "HELLO_DRONE_NETWORK",
          p2pPort: P2P_PORT,
        });
        udpSocket.send(
          beaconMsg,
          UDP_DISCOVERY_PORT,
          "255.255.255.255",
          (err) => {
            if (err) console.error("❌ Error sending UDP beacon: ", err);
          },
        );
      }, 5000);
    }
    startUDPRadar();
    registerInDirectory();
    startTelemetryLoop();
  } catch (error) {
    console.error("❌ Error: ", error);
  }
}

main();
