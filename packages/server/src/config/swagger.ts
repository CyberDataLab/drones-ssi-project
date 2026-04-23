import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { CONFIG } from './env';

export const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'TFM SSI Drones API',
        version: '1.0.0',
        description: 'API Documentation for the Drone Self-Sovereign Identity and Telemetry Server. Built with Hyperledger Fabric and Veramo.'
    },
    servers: [
        { url: `https://localhost:${CONFIG.PORT}`, description: 'Local Server' }
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Enter your JWT token obtained from /auth/login'
            }
        }
    },
    paths: {
        '/auth/login': {
            post: {
                summary: 'Login to get JWT token',
                tags: ['Authentication'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    username: { type: 'string', example: 'admin' },
                                    password: { type: 'string', example: 'admin' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Successful login. Returns JWT token.' },
                    '401': { description: 'Invalid Credentials' }
                }
            }
        },
        '/auth/register': {
            post: {
                summary: 'Register a new user (Admin only)',
                tags: ['Authentication'],
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    username: { type: 'string' },
                                    password: { type: 'string' },
                                    role: { type: 'string', enum: ['admin', 'auditor'] }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'User created' },
                    '403': { description: 'Access denied' }
                }
            }
        },
        '/drones': {
            get: {
                summary: 'Get all registered drones from Blockchain',
                tags: ['Drones'],
                security: [{ BearerAuth: [] }],
                responses: {
                    '200': { description: 'List of drones' }
                }
            }
        },
        '/register': {
            post: {
                summary: 'Register a new drone in the Blockchain',
                tags: ['Drones'],
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    droneDid: { type: 'string', example: 'did:key:z6Mk...' },
                                    name: { type: 'string', example: 'Drone-Alpha' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Drone registered successfully' }
                }
            }
        },
        '/history/{did}': {
            get: {
                summary: 'Get telemetry history for a specific drone',
                tags: ['Telemetry'],
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: 'did',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'The DID of the drone'
                    }
                ],
                responses: {
                    '200': { description: 'Telemetry data' }
                }
            }
        },
        '/messaging': {
            post: {
                summary: 'Receive DIDComm messages from drones',
                tags: ['SSI & DIDComm'],
                description: 'Endpoint used by drones to send their telemetry packed inside Verifiable Credentials via DIDComm.',
                requestBody: {
                    required: true,
                    content: {
                        '*/*': {
                            schema: { type: 'string' },
                            example: '{"protected":"...","iv":"...","ciphertext":"...","tag":"..."}'
                        }
                    }
                },
                responses: {
                    '200': { description: 'Data verified and saved on-chain' },
                    '400': { description: 'Invalid or revoked credential' },
                    '403': { description: 'Identity mismatch' }
                }
            }
        },
        '/revoke': {
            post: {
                summary: 'Revoke a Verifiable Credential',
                tags: ['SSI & DIDComm'],
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    credentialId: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Credential revoked' }
                }
            }
        },
        '/revocations': {
            get: {
                summary: 'Get list of revoked credentials',
                tags: ['SSI & DIDComm'],
                security: [{ BearerAuth: [] }],
                responses: {
                    '200': { description: 'List of revoked credential IDs' }
                }
            }
        }
    }
};

export const setupSwagger = (app: Express) => {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};