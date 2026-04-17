import { BbsBlsSignatureProof2020, deriveProof } from "@mattrglobal/jsonld-signatures-bbs";
import { randomBytes } from "crypto";

export async function deriveZkpPresentation(credential: any, documentLoader: any) {
    console.log("⚙️ [ZKP] Sanitizing credential for WASM engine...");

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
            authorizedArea: {},
        },
    };

    const nonce = randomBytes(32);

    try {
        const zkp = await deriveProof(cred, revealDocument, {
            suite: new BbsBlsSignatureProof2020(),
            documentLoader: documentLoader,
            nonce: nonce,
        });
        return zkp;
    } catch (error: any) {
        console.error("🚨 [MATTR ERROR]:", error.message);
        throw error;
    }
}