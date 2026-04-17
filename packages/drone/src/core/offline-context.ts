import * as fs from "fs";
import { preloadedContexts } from "../cache/cache-contexts"; // Ajusta el path según tu proyecto
// @ts-ignore
import { extendContextLoader } from "jsonld-signatures";
import { config } from "../config/env";

export function createDocumentLoader(agent: any) {
    const contextCache = new Map();

    for (const [url, data] of Object.entries(preloadedContexts)) {
        contextCache.set(url, data);
    }

    const customLoader = async (url: string) => {
        if (contextCache.has(url)) return contextCache.get(url);

        if (url.startsWith("did:")) {
            const baseDid = url.split("#")[0];
            const resolution = (await agent.resolveDid({ didUrl: baseDid })) as any;

            if (fs.existsSync(config.AUTHORITY_PUB_KEY)) {
                const authKey = JSON.parse(fs.readFileSync(config.AUTHORITY_PUB_KEY, "utf-8"));
                const keyString = authKey.publicKeyBase58 || authKey.publicKey;

                const cleanKey = {
                    type: "Bls12381G2Key2020",
                    controller: baseDid,
                    publicKeyBase58: keyString,
                };

                const keyId1 = `${baseDid}#bbs-key-1`;
                const keyId2 = `${baseDid}#bbs-key`;

                if (!resolution.didDocument.verificationMethod) resolution.didDocument.verificationMethod = [];
                if (!resolution.didDocument.assertionMethod) resolution.didDocument.assertionMethod = [];

                resolution.didDocument.verificationMethod = resolution.didDocument.verificationMethod.filter(
                    (k: any) => k.id !== keyId1 && k.id !== keyId2,
                );

                resolution.didDocument.verificationMethod.push({ ...cleanKey, id: keyId1 });
                resolution.didDocument.verificationMethod.push({ ...cleanKey, id: keyId2 });
                resolution.didDocument.assertionMethod.push(keyId1);
                resolution.didDocument.assertionMethod.push(keyId2);
            }

            const result = { contextUrl: null, documentUrl: url, document: resolution.didDocument };
            contextCache.set(url, result);
            return result;
        }

        const response = await fetch(url, { headers: { Accept: "application/ld+json" }, redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);

        const result = { contextUrl: null, documentUrl: url, document: await response.json() };
        contextCache.set(url, result);
        return result;
    };

    return extendContextLoader(customLoader);
}