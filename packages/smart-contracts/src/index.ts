import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';

@Info({ title: 'DroneTelemetry', description: 'Smart Contract for managing drone telemetry data and registry' })
export class DroneContract extends Contract {

    @Transaction()
    public async InitLedger(ctx: Context): Promise<void> {
        const genesisData = {
            docType: 'telemetry',
            txId: 'genesis_tx',
            timestamp: '2026-01-01T00:00:00Z', // Static timestamp for genesis block. This way we avoid any issues with non-deterministic timestamps during ledger initialization.
            droneDid: 'did:key:genesis',
            battery: 100,
            altitude: 0,
            temperature: 20.5
        };
        await ctx.stub.putState(genesisData.txId, Buffer.from(stringify(sortKeysRecursive(genesisData))));
        console.log('Ledger initialized with genesis data');
    }


    /**
     * 
     * @param ctx 
     * @param txId 
     * @param droneDid 
     * @param vcString 
     */
    @Transaction()
    public async SaveTelemetryVC(ctx: Context, txId: string, droneDid: string, vcString: string): Promise<void> {
        const recordId = txId;
        const blockchainTxId = ctx.stub.getTxID();

        const telemetryRecord = {
            docType: 'telemetry',
            id: recordId,
            txId: blockchainTxId,
            droneDid: droneDid,
            vc: vcString
        };

        await ctx.stub.putState(txId, Buffer.from(stringify(sortKeysRecursive(telemetryRecord))));
        console.info(`✅ Telemetry VC saved with txId: ${txId}`);
    }


    /**
     * 
     * @param ctx 
     * @returns 
     */
    @Transaction(false)
    @Returns('string')
    public async GetAllTelemetry(ctx: Context): Promise<string> {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '\uFFFF');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                allResults.push(record);
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }

    /**
     * 
     * @param ctx 
     * @param droneDid 
     * @returns 
     */
    @Transaction(false)
    @Returns('string')
    public async QueryTelemetryByDid(ctx: Context, droneDid: string): Promise<string> {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '\uFFFF');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }

            if (typeof record === 'object' && record.droneDid === droneDid && record.docType === 'telemetry') {
                allResults.push(record);
            }
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }

    /**
     * 
     * @param ctx 
     * @param droneDid 
     * @param friendlyName 
     * @param timestamp 
     */
    @Transaction()
    public async RegisterDrone(ctx: Context, droneDid: string, friendlyName: string, timestamp: string): Promise<void> {
        const key = droneDid;
        const blockchainTxId = ctx.stub.getTxID();
        const droneEntry = {
            docType: 'drone_registry',
            txId: blockchainTxId,
            timestamp: timestamp,
            droneDid: droneDid,
            name: friendlyName,
            battery: 0,
            altitude: 0,
            temperature: 0
        };

        await ctx.stub.putState(key, Buffer.from(stringify(sortKeysRecursive(droneEntry))));
        console.info(`✅ Registry saved. Fingerprint: ${blockchainTxId}`);
    }

    /**
     * 
     * @param ctx 
     * @returns 
     */
    @Transaction(false)
    @Returns('string')
    public async GetRegisteredDrones(ctx: Context): Promise<string> {
        const allDrones = [];
        const iterator = await ctx.stub.getStateByRange('', '\uFFFF');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                if (record.docType === 'drone_registry') {
                    allDrones.push(record);
                }
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        return JSON.stringify(allDrones);
    }

    /**
     * 
     * @param ctx 
     * @returns 
     */
    @Transaction(false)
    @Returns('string')
    public async GetAllDronesInLedger(ctx: Context): Promise<string> {
        const droneMap = new Map<string, string>();
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);

                if (record.docType === 'drone_registry') {
                    droneMap.set(record.droneDid, record.name);
                }
                if (record.docType === 'telemetry') {
                    if (!droneMap.has(record.droneDid)) {
                        droneMap.set(record.droneDid, 'Unknown Drone (Unregistered)');
                    }
                }

            } catch (err) { }
            result = await iterator.next();
        }

        const allDrones = Array.from(droneMap, ([did, name]) => ({ droneDid: did, name: name }));
        return JSON.stringify(allDrones);
    }

    /**
     * Revokes a specific credential by its ID.
     * @param credentialId The unique ID of the VC (the "id" field in the VC JSON)
     */
    @Transaction()
    public async RevokeCredential(ctx: Context, credentialId: string, timestamp: string): Promise<void> {
        const revocationKey = `REVOC_${credentialId}`;

        const revocationRecord = {
            docType: 'revocation_list',
            credentialId: credentialId,
            revokedAt: timestamp,
            reason: 'Administrative / Theft / Compromise' // In a real implementation, you might want to allow specifying the reason for revocation
        };

        await ctx.stub.putState(revocationKey, Buffer.from(JSON.stringify(revocationRecord)));
        console.info(`⛔ Credential ${credentialId} revoked.`);
    }

    /**
     * Verifies if a credential is revoked.
     * Note: This function assumes that the credential ID is unique and corresponds to the "id" field in the VC JSON. In a real-world scenario, you might want to implement a more robust mapping between credentials and their revocation status.
     * @param ctx 
     * @param credentialId 
     * @returns TRUE if revoked (invalid), FALSE if clean
     */
    @Transaction(false)
    @Returns('boolean')
    public async IsCredentialRevoked(ctx: Context, credentialId: string): Promise<boolean> {
        const revocationKey = `REVOC_${credentialId}`;
        const recordBytes = await ctx.stub.getState(revocationKey);
        return (recordBytes && recordBytes.length > 0);
    }

    /**
     * 
     * @param ctx 
     * @returns 
     */
    @Transaction(false)
    @Returns('string')
    public async GetRevocationList(ctx: Context): Promise<string> {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                if (record.docType === 'revocation_list') {
                    allResults.push(record);
                }
            } catch (err) { }
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }
}

// Export the contract classes as an array for use in the chaincode
export const contracts: any[] = [DroneContract];