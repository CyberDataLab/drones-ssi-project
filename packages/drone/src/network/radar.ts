import * as dgram from "dgram";
import { config } from "../config/env";
import { droneState } from "../core/state";
import { deriveZkpPresentation } from "../services/zkp-engine";

export function startUDPRadar(agent: any, myBbsCredential: any, documentLoader: any) {
    const udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    udpSocket.on("listening", () => {
        udpSocket.setBroadcast(true);
        console.log(`📡 UDP Radar listening on port ${config.UDP_DISCOVERY_PORT}`);
    });

    udpSocket.on("message", (msg, rinfo) => {
        try {
            const message = JSON.parse(msg.toString());
            if (message.type === "HELLO_DRONE_NETWORK") {
                const peerId = `${rinfo.address}:${message.p2pPort}`;
                // const isMe = (rinfo.address === MY_IP || rinfo.address === '127.0.0.1') // REAL SCENARIO
                const isMe = message.p2pPort === config.P2P_PORT;

                if (!isMe && !droneState.knownPeers.has(peerId)) {
                    console.log(`👋 Discovered peer drone at ${peerId}`);
                    droneState.knownPeers.set(peerId, {
                        ip: rinfo.address,
                        port: message.p2pPort,
                        status: "discovered"
                    });
                    initiateZkpChallenge(agent, rinfo.address, message.p2pPort, myBbsCredential, documentLoader);
                }
            }
        } catch (e) { }
    });

    udpSocket.bind(config.UDP_DISCOVERY_PORT);

    setInterval(() => {
        const beaconMsg = JSON.stringify({
            type: "HELLO_DRONE_NETWORK",
            p2pPort: config.P2P_PORT
        });
        udpSocket.send(beaconMsg, config.UDP_DISCOVERY_PORT, "255.255.255.255", (err) => {
            if (err) console.error("❌ Error sending UDP beacon: ", err);
        },);
    }, config.BROADCAST_BEACON_INTERVAL);
}

async function initiateZkpChallenge(agent: any, peerIp: string, peerPort: number, myBbsCredential: any, documentLoader: any) {

    console.log(`🔐 Initiating ZKP challenge with peer at ${peerIp}:${peerPort}`);

    try {
        const zkp = await deriveZkpPresentation(myBbsCredential, documentLoader);
        const ephemeralIdentity = await agent.didManagerCreate({ provider: 'did:key' });
        const ephemeralDid = ephemeralIdentity.did;

        console.log(`🔐 Generated ephemeral DID (${ephemeralDid}) to hide real identity during challenge.`);

        const challengeMessage = {
            type: "https://didcomm.org/drone-metrics/1.0/zkp-challenge",
            from: ephemeralDid,
            body: { zkp: zkp, replyPort: config.P2P_PORT },
        };

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