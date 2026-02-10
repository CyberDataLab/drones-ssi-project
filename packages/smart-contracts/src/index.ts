import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';

@Info({title: 'DroneTelemetry', description: 'Smart Contract para Trazabilidad de Drones'})
export class DroneContract extends Contract {

    @Transaction()
    public async InitLedger(ctx: Context): Promise<void> {
        // CORRECCIÓN: Usamos una fecha FIJA para el génesis para evitar errores de determinismo
        const genesisData = {
            docType: 'telemetry',
            txId: 'genesis_tx',
            timestamp: '2026-01-01T00:00:00Z', 
            droneDid: 'did:key:genesis',
            battery: 100,
            altitude: 0,
            temperature: 20.5
        };
        await ctx.stub.putState(genesisData.txId, Buffer.from(stringify(sortKeysRecursive(genesisData))));
        console.log('Ledger inicializado con datos génesis');
    }

    @Transaction()
    public async CreateTelemetry(ctx: Context, txId: string, timestamp: string, droneDid: string, battery: number, altitude: number, temperature: number): Promise<void> {
        // ID generado por el cliente (útil para búsquedas rápidas)
        const recordId = txId; 
        
        // ID REAL DE BLOCKCHAIN (La huella inmutable)
        const blockchainTxId = ctx.stub.getTxID();

        const telemetry = {
            docType: 'telemetry',
            id: recordId,            // ID lógico (ej: tx-12345)
            txId: blockchainTxId,    // Huella criptográfica (ej: a1b2c3d4...)
            timestamp: timestamp,
            droneDid: droneDid,
            battery: battery,
            altitude: altitude,
            temperature: temperature
        };

        await ctx.stub.putState(recordId, Buffer.from(stringify(sortKeysRecursive(telemetry))));
    }

    @Transaction(false)
    public async ReadTelemetry(ctx: Context, txId: string): Promise<string> {
        const telemetryJSON = await ctx.stub.getState(txId);
        if (!telemetryJSON || telemetryJSON.length === 0) {
            throw new Error(`El registro ${txId} no existe`);
        }
        return telemetryJSON.toString();
    }

    @Transaction(false)
    @Returns('string')
    public async GetAllTelemetry(ctx: Context): Promise<string> {
        const allResults = [];
        // CORRECCIÓN: Rango explícito para evitar problemas de búsqueda
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
                record = strValue; // En caso de error, guardamos el string crudo
            }

            if (typeof record === 'object' && record.droneDid === droneDid && record.docType === 'telemetry') {
                allResults.push(record);
            }
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }

    @Transaction(false)
    @Returns('boolean')
    public async TelemetryExists(ctx: Context, txId: string): Promise<boolean> {
        const telemetryJSON = await ctx.stub.getState(txId);
        return telemetryJSON && telemetryJSON.length > 0;
    }

    @Transaction()
    public async RegisterDrone(ctx: Context, droneDid: string, friendlyName: string, timestamp: string): Promise<void> {
        const key = droneDid; 
        
        // CAPTURAMOS LA HUELLA REAL
        const blockchainTxId = ctx.stub.getTxID();

        const droneEntry = {
            docType: 'drone_registry',
            txId: blockchainTxId,   
            timestamp: timestamp, 
            droneDid: droneDid,     // Guardamos el DID explícitamente
            name: friendlyName,
            battery: 0,
            altitude: 0,
            temperature: 0
        };

        await ctx.stub.putState(key, Buffer.from(stringify(sortKeysRecursive(droneEntry))));
        console.info(`✅ Registro guardado. Huella: ${blockchainTxId}`);
    }

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
                // Filtramos por docType
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
     * Obtiene una lista unificada de TODOS los drones visibles en el Ledger,
     * ya sean registrados o simples emisores anónimos de telemetría.
     */
    @Transaction(false)
    @Returns('string')
    public async GetAllDronesInLedger(ctx: Context): Promise<string> {
        const droneMap = new Map<string, string>(); // Mapa DID -> Nombre

        // 1. Primero, obtenemos los nombres registrados
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);

                // A. Si es un registro de nombre, guardamos el nombre
                if (record.docType === 'drone_registry') {
                    droneMap.set(record.droneDid, record.name);
                }
                
                // B. Si es telemetría, guardamos el DID (si no existe ya)
                // Si ya tiene nombre (paso A), no lo sobrescribimos.
                if (record.docType === 'telemetry') {
                    if (!droneMap.has(record.droneDid)) {
                        droneMap.set(record.droneDid, 'Dron Desconocido (Sin Registro)');
                    }
                }

            } catch (err) {}
            result = await iterator.next();
        }

        // Convertimos el mapa a array para devolverlo
        const allDrones = Array.from(droneMap, ([did, name]) => ({ droneDid: did, name: name }));
        
        return JSON.stringify(allDrones);
    }

    /**
     * Revoca una credencial específica por su ID.
     * @param credentialId El ID único de la VC (campo 'id' del JSON de la credencial)
     */
    @Transaction()
    public async RevokeCredential(ctx: Context, credentialId: string, timestamp: string): Promise<void> {
        const revocationKey = `REVOC_${credentialId}`;
        
        const revocationRecord = {
            docType: 'revocation_list',
            credentialId: credentialId,
            revokedAt: timestamp, 
            reason: 'Administrativa / Robo'
        };

        await ctx.stub.putState(revocationKey, Buffer.from(JSON.stringify(revocationRecord)));
        console.info(`⛔ Credencial ${credentialId} revocada exitosamente.`);
    }

    /**
     * Verifica si una credencial está revocada.
     * Retorna TRUE si está revocada (NO válida), FALSE si está limpia.
     */
    @Transaction(false)
    @Returns('boolean')
    public async IsCredentialRevoked(ctx: Context, credentialId: string): Promise<boolean> {
        const revocationKey = `REVOC_${credentialId}`;
        const recordBytes = await ctx.stub.getState(revocationKey);
        
        // Si existe registro, es que está revocada
        return (recordBytes && recordBytes.length > 0);
    }
}

export const contracts: any[] = [ DroneContract ];