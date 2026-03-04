export const preloadedContexts = {
  "https://w3id.org/security/suites/jws-2020/v1": {
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
  },


  "https://w3id.org/security/bbs/v1": {
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
  },


  'https://www.w3.org/2018/credentials/v1': {
    contextUrl: null,
    documentUrl: 'https://www.w3.org/2018/credentials/v1',
    document: {
      "@context": {
        "@version": 1.1,
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "VerifiableCredential": {
          "@id": "https://www.w3.org/2018/credentials#VerifiableCredential",
          "@context": {
            "@version": 1.1,
            "@protected": true,
            "id": "@id",
            "type": "@type",
            "credentialSubject": { "@id": "https://www.w3.org/2018/credentials#credentialSubject", "@type": "@id" },
            "issuer": { "@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id" },
            "issuanceDate": { "@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
            "expirationDate": { "@id": "https://www.w3.org/2018/credentials#expirationDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
            "proof": { "@id": "https://w3id.org/security#proof", "@type": "@id", "@container": "@graph" }
          }
        },
        "VerifiablePresentation": {
          "@id": "https://www.w3.org/2018/credentials#VerifiablePresentation",
          "@context": {
            "@version": 1.1,
            "@protected": true,
            "id": "@id",
            "type": "@type",
            "holder": { "@id": "https://www.w3.org/2018/credentials#holder", "@type": "@id" },
            "verifiableCredential": { "@id": "https://www.w3.org/2018/credentials#verifiableCredential", "@type": "@id", "@container": "@graph" },
            "proof": { "@id": "https://w3id.org/security#proof", "@type": "@id", "@container": "@graph" }
          }
        }
      }
    }
  }
}