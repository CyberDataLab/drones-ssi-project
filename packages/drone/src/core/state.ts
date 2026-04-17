export interface PeerState {
    ip: string;
    port: number;
    status: "discovered" | "zkp_verified" | "fully_authenticated";
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