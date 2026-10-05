export type DeviceKind = "battery" | "inverter";

export interface Device {
    id: string;
    vendor: string;
    vendorDeviceId: string;
    kind: DeviceKind;
    model: string;
}

export interface Telemetry {
    deviceId: string;
    powerW: number;
    stateOfChargePct?: number;
    exportLimitPct?: number;
    measuredAt: string;
}

export type ControlCommand =
    | { type: "battery_mode"; mode: "charge" | "discharge" | "idle"; powerW?: number | undefined }
    | { type: "export_limit"; percent: number };

export type ActionState = "pending" | "confirmed" | "failed" | "timed_out";

export interface Action {
    id: string;
    deviceId: string;
    command: ControlCommand;
    state: ActionState;
    vendorReference?: string;
    failureReason?: string;
    createdAt: string;
    updatedAt: string;
}

export class UnsupportedCommandError extends Error {}
export class VendorError extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.retryable = retryable;
    }
}
