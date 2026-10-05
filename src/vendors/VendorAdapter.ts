import type { ControlCommand, Device, Telemetry } from "../domain/types.ts";

export type VendorCommandStatus = "pending" | "done" | "failed";

export interface VendorAdapter {
    readonly vendor: string;
    listDevices(): Promise<Device[]>;
    readTelemetry(device: Device): Promise<Telemetry>;
    sendCommand(device: Device, command: ControlCommand): Promise<string>;
    commandStatus(device: Device, reference: string): Promise<VendorCommandStatus>;
}
