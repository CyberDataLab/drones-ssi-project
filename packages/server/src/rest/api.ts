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

    router.post('/auth/register', authenticateToken, requireAdmin, async (req: any, res: Response) => {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing required fields' });

        const users = getUsers();
        if (users.some((u: any) => u.username === username)) return res.status(400).json({ error: 'User already exists' });
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, passwordHash: hashedPassword, role: role === 'admin' ? 'admin' : 'auditor' });
        fs.writeFileSync(CONFIG.USER_FILE, JSON.stringify(users, null, 2));
        res.json({ message: 'User Created Successfully' });
    });

    // --- DIDComm Messaging Route ---
    router.post('/messaging', async (req: Request, res: Response) => {
        try {
            console.log('\n📩 Receiving DIDComm message (Store & Forward package)...');


            const unpacked = await ssiService.unpackMessage(req.body);
            const { from: relayerDid, body } = unpacked.message;
            const { ownTelemetry, relayedTelemetry = [] } = body;

            const allTelemetryVCs: any[] = [];
            if (ownTelemetry) allTelemetryVCs.push(ownTelemetry);
            if (Array.isArray(relayedTelemetry)) allTelemetryVCs.push(...relayedTelemetry);

            if (allTelemetryVCs.length === 0) {
                return res.status(400).send('No telemetry data found in the package');
            }

            console.log(`📦 Unpacked package from ${relayerDid}. Contains ${allTelemetryVCs.length} signed records.`);

            let processedCount = 0;

            for (const vc of allTelemetryVCs) {
                try {

                    const verificationResult = await ssiService.verifyCredential(vc);
                    if (!verificationResult.verified) {
                        console.warn(`⚠️ Skipping VC: Invalid signature from issuer ${vc.issuer?.id}`);
                        // --- DIAGNOSTIC TOOL: Print the exact cryptographic error ---
                        console.error(`🔍 EXACT VERIFICATION ERROR:`, JSON.stringify(verificationResult.error, null, 2));

                        // --- DIAGNOSTIC TOOL: Check for Raspberry Pi Time Skew ---
                        const droneTime = new Date(vc.issuanceDate).getTime();
                        const serverTime = Date.now();
                        const timeDifferenceSeconds = (droneTime - serverTime) / 1000;

                        console.log(`⏱️ Drone Clock:  ${new Date(droneTime).toISOString()}`);
                        console.log(`⏱️ Server Clock: ${new Date(serverTime).toISOString()}`);

                        if (timeDifferenceSeconds > 0) {
                            console.error(`🚨 HARDWARE WARNING: The Drone's clock is ${timeDifferenceSeconds} seconds IN THE FUTURE compared to the server. Veramo blocks future JWTs!`);
                        }
                    }
                    const originalGeneratorDid = vc.credentialSubject?.id;
                    const telemetryData = vc.credentialSubject?.telemetry;
                    const droneLicense = vc.credentialSubject?.droneLicense;

                    if (!originalGeneratorDid || !telemetryData) {
                        console.warn(`⚠️ Skipping VC: Missing subject ID or telemetry data`);
                        continue;
                    }

                    if (droneLicense && droneLicense.id) {
                        const isRevoked = await bcService.isRevoked(droneLicense.id);
                        if (isRevoked) {
                            console.warn(`⛔ Skipping VC: The license ${droneLicense.id} belonging to ${originalGeneratorDid} is REVOKED.`);
                            continue;
                        }
                    }

                    const { battery = 0, altitude = 0, temperature = 0, temp = 0, timestamp = new Date().toISOString() } = telemetryData;
                    const tempValue = temperature || temp;

                    fs.appendFileSync(CONFIG.DATASET_FILE, `${timestamp},${originalGeneratorDid},${battery},${altitude},${tempValue}\n`);

                    const uniqueTxId = `flight-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

                    // Convert the full Verifiable Credential to a string to store it immutably
                    const stringifiedVC = JSON.stringify(vc);

                    // Write the Cryptographic Proof to Hyperledger Fabric
                    await bcService.saveTelemetryVC(uniqueTxId, originalGeneratorDid, stringifiedVC);
                    processedCount++;
                    console.log(`✅ Processed telemetry from ${originalGeneratorDid}. Data saved to ledger with TxID: ${uniqueTxId}. Battery: ${battery}%, Altitude: ${altitude}m, Temperature: ${tempValue}°C`);
                } catch (vcError) {
                    console.error(`❌ Error processing an individual VC:`, vcError);
                    // We catch inner errors so one bad VC doesn't reject the valid ones in the batch
                }
            }

            console.log(`✅ Package processing complete. Saved ${processedCount}/${allTelemetryVCs.length} valid records to Ledger.`);
            res.json({ status: 'success', message: `Data verified and saved. Processed ${processedCount}/${allTelemetryVCs.length} records.` });

        } catch (error) {
            console.error('❌ Error processing DIDComm envelope:', error);
            res.status(500).send('Internal Server Error processing secure envelope');
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

    // router.get('/history/:did', authenticateToken, async (req: Request, res: Response) => {
    //     try {
    //         const didParam = req.params.did as string;
    //         const cleanDid = decodeURIComponent(didParam);
    //         const data = await bcService.getTelemetryByDid(cleanDid);

    //         res.json(JSON.parse(data));
    //     } catch (error) {
    //         console.error('❌ Error obtaining telemetry data:', error);
    //         res.status(500).send({ error: 'Error obtaining telemetry data from Blockchain' });
    //     }
    // });

    router.get('/history/:did', authenticateToken, async (req: Request, res: Response) => {
        try {
            const didParam = req.params.did as string;
            const cleanDid = decodeURIComponent(didParam);
            const rawBlockchainData = await bcService.getTelemetryByDid(cleanDid);

            const ledgerRecords = JSON.parse(rawBlockchainData);

            const formattedHistory = ledgerRecords.map((record: any) => {
                try {
                    let parsedVC = record.vc;
                    if (typeof record.vc === 'string') {
                        parsedVC = JSON.parse(record.vc);
                    }

                    const telemetryData = parsedVC?.credentialSubject?.telemetry;

                    // Return a clean, flat object that is easy to show on a screen/frontend
                    return {
                        droneDid: record.droneDid,
                        txId: record.txId || record.id,
                        timestamp: telemetryData?.timestamp || record.timestamp,
                        battery: telemetryData?.battery,
                        altitude: telemetryData?.altitude,
                        temperature: telemetryData?.temperature || telemetryData?.temp,
                        cryptographicallyVerified: true // A flag to show the UI this data comes from a VC
                    };
                } catch (parseError) {
                    console.warn(`⚠️ Warning: Could not parse VC for transaction ${record.txId}`);
                    // Fallback in case there is old data without VCs in the ledger
                    return {
                        txId: record.txId || record.id,
                        timestamp: record.timestamp,
                        battery: record.battery,
                        altitude: record.altitude,
                        temperature: record.temperature,
                        cryptographicallyVerified: false
                    };
                }
            });

            res.json(formattedHistory);

        } catch (error) {
            console.error('❌ Error obtaining telemetry data:', error);
            res.status(500).send({ error: 'Error obtaining telemetry data from Blockchain' });
        }
    });

    router.get('/drones', authenticateToken, async (req: Request, res: Response) => {
        try {
            const drones = await bcService.getAllDrones();
            res.json(drones);
        } catch (error) {
            console.error('❌ Error obtaining drones list:', error);
            res.status(500).send({ error: 'Blockchain Error' });
        }
    });

    router.post('/register', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
        try {
            const { droneDid, name } = req.body;

            if (!droneDid || !name) {
                return res.status(400).json({ error: 'Missing data (DID or Name)' });
            }

            await bcService.registerDrone(droneDid, name);
            res.json({ status: 'success', message: `Drone ${name} registered successfully` });

        } catch (error) {
            console.error('❌ Error registering drone:', error);
            res.status(500).json({ error: 'Internal Blockchain error while registering drone' });
        }
    });

    router.post('/revoke', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
        try {
            const { credentialId } = req.body;
            if (!credentialId) {
                return res.status(400).json({ error: 'Missing credential ID' });
            }

            await bcService.revokeCredential(credentialId);
            console.log(`⛔ Credential revoked via API: ${credentialId}`);

            res.json({ status: 'success', message: 'Credential revoked successfully' });
        } catch (e) {
            console.error('❌ Error revoking credential: ', e);
            res.status(500).json({ error: 'Error revoking credential in Blockchain' });
        }
    });

    router.get('/revocations', authenticateToken, async (req: Request, res: Response) => {
        try {
            const list = await bcService.getRevocationList();
            res.json(list);
        } catch (error) {
            console.error('❌ Error obtaining revocation list:', error);
            res.status(500).json({ error: 'Blockchain Error' });
        }
    });

    return router;
}