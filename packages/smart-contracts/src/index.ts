import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';

@Info({title: 'DroneTelemetry', description: 'Smart Contract para Trazabilidad de Drones'})
export class DroneContract extends Contract {

    @Transaction()
    public async InitLedger(ctx: Context): Promise<void> {
        const genesisData = {
            docType: 'telemetry',
            txId: 'genesis_tx',
            timestamp: new Date().toISOString(),
            droneDid: 'did:key:genesis',
            battery: 100,
            altitude: 0,
            temperature: 20.5
        };
        // Convertimos a Buffer explícitamente
        await ctx.stub.putState(genesisData.txId, Buffer.from(stringify(sortKeysRecursive(genesisData))));
        console.log('Ledger inicializado con datos génesis');
    }

    @Transaction()
    public async CreateTelemetry(ctx: Context, txId: string, timestamp: string, droneDid: string, battery: number, altitude: number, temperature: number): Promise<void> {
        
        const exists = await this.TelemetryExists(ctx, txId);
        if (exists) {
            throw new Error(`El registro ${txId} ya existe`);
        }

        // CORRECCIÓN: Usamos un Objeto Plano (Plain Object), no una clase
        const telemetry = {
            docType: 'telemetry',
            txId: txId,
            timestamp: timestamp,
            droneDid: droneDid,
            battery: battery,
            altitude: altitude,
            temperature: temperature
        };

        // Guardamos
        await ctx.stub.putState(txId, Buffer.from(stringify(sortKeysRecursive(telemetry))));
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
        const iterator = await ctx.stub.getStateByRange('', '');
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
            allResults.push(record);
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
}

// Exportación obligatoria para que el contenedor arranque
export const contracts: any[] = [ DroneContract ];