export interface PeerState {
    ip: string;
    port: number;
    status: "discovered" | "zkp_verified" | "fully_authenticated" | "zkp_verified_pending_real_id";
    did?: string;
}

export const droneState = {
    isConnectedToServer: false,
    serverLicenseValidUntil: null as Date | null,
    telemetryBuffer: [] as any[],
    knownPeers: new Map<string, PeerState>(),
    isSendingTelemetry: false,
    simBattery: 100,
    simAltitude: 50,
};