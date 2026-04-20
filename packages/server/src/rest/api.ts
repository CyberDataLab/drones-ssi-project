import { Router, Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import { CONFIG } from '../config/env';
import { BlockchainService } from '../services/blockchain';
import { SSIService } from '../services/ssi';

export function setupRoutes(bcService: BlockchainService, ssiService: SSIService): Router {
    const router = Router();
    const droneDirectory = new Map<string, string>();

    // --- Middlewares ---
    const authenticateToken = (req: any, res: Response, next: NextFunction) => {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Token not provided' });

        jwt.verify(token, CONFIG.JWT_SECRET, (err: any, user: any) => {
            if (err) return res.status(403).json({ error: 'Invalid token' });
            req.user = user;
            next();
        });
    };

    const requireAdmin = (req: any, res: Response, next: NextFunction) => {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
        next();
    };

    // --- Helper ---
    const getUsers = () => {
        if (!fs.existsSync(CONFIG.USER_FILE)) return [];
        return JSON.parse(fs.readFileSync(CONFIG.USER_FILE, 'utf-8'));
    };

    // --- Auth Routes ---
    router.post('/auth/login', async (req: Request, res: Response) => {
        const { username, password } = req.body;
        const user = getUsers().find((u: any) => u.username === username);
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Invalid Credentials' });
        }
        const token = jwt.sign({ username: user.username, role: user.role }, CONFIG.JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, role: user.role, username: user.username });
    });

    // --- DIDComm Messaging Route ---
    router.post('/messaging', async (req: Request, res: Response) => {
        try {
            const unpacked = await ssiService.unpackMessage(req.body);
            const { from: droneDid, body } = unpacked.message;
            const credentials = body.verifiableCredential;

            if (!credentials?.length) return res.status(401).send('No credentials provided');

            const targetCredential = credentials[0];
            const verificationResult = await ssiService.verifyCredential(targetCredential);

            if (!verificationResult.verified) {
                return res.status(400).json({ error: 'invalid_credential', message: 'Verification failed.' });
            }

            if (targetCredential.credentialSubject?.id !== droneDid) {
                return res.status(403).json({ error: 'identity_mismatch', message: 'Credential does not belong to sender.' });
            }

            const isRevoked = await bcService.isRevoked(targetCredential.id);
            if (isRevoked) return res.status(400).json({ error: 'revoked_credential' });

            // Save to CSV & Blockchain
            const { battery = 0, altitude = 0, temperature = 0, temp = 0, timestamp = new Date().toISOString() } = body;
            const tempValue = temperature || temp;

            fs.appendFileSync(CONFIG.DATASET_FILE, `${timestamp},${droneDid},${battery},${altitude},${tempValue}\n`);
            await bcService.createTelemetry(`flight-${Date.now()}`, timestamp, droneDid, battery, altitude, tempValue);

            res.json({ status: 'success', message: 'Data verified and saved' });
        } catch (error) {
            console.error('❌ Error processing message:', error);
            res.status(500).send('Internal Server Error');
        }
    });

    // --- Directory & Drones Routes ---
    router.post('/directory', (req: Request, res: Response) => {
        const { action, did, endpoint } = req.body;
        if (action === 'register') {
            droneDirectory.set(did, endpoint);
            return res.status(200).json({ status: 'registered', serverCredential: ssiService.serverCredential });
        }
        if (action === 'lookup') {
            const target = droneDirectory.get(did);
            return target ? res.status(200).json({ endpoint: target }) : res.status(404).json({ error: 'Not Found' });
        }
        res.status(400).send('Invalid action.');
    });

    // Additional routes (history, drones, register, revoke...) follow the same pattern
    // They just call bcService methods and return the response.

    return router;
}