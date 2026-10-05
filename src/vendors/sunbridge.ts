import { UnsupportedCommandError, type ControlCommand, type Device, type Telemetry } from "../domain/types.ts";
import type { ResilientClient } from "./resilientClient.ts";
import type { VendorAdapter, VendorCommandStatus } from "./VendorAdapter.ts";

interface InverterPage {
    data: { id: string; sku: string }[];
    total: number;
}

interface InverterLive {
    acPowerW: number;
    exportLimit: number;
    timestamp: string;
}

const PAGE_SIZE = 50;
const STATES: Record<string, VendorCommandStatus> = { IN_PROGRESS: "pending", SUCCEEDED: "done", ERROR: "failed" };

export class SunBridgeAdapter implements VendorAdapter {
    readonly vendor = "sunbridge";
    private readonly client: ResilientClient;
    private readonly headers: HeadersInit;

    constructor(client: ResilientClient, apiKey: string) {
        this.client = client;
        this.headers = { "X-Api-Key": apiKey };
    }

    async listDevices(): Promise<Device[]> {
        const devices: Device[] = [];
        for (let page = 0; ; page += 1) {
            const response = await this.client.request<InverterPage>(`/api/inverters?page=${page}&size=${PAGE_SIZE}`, { headers: this.headers });
            devices.push(
                ...response.data.map((item) => ({
                    id: `${this.vendor}:${item.id}`,
                    vendor: this.vendor,
                    vendorDeviceId: item.id,
                    kind: "inverter" as const,
                    model: item.sku,
                })),
            );
            if ((page + 1) * PAGE_SIZE >= response.total || response.data.length === 0) {
                return devices;
            }
        }
    }

    async readTelemetry(device: Device): Promise<Telemetry> {
        const live = await this.client.request<InverterLive>(`/api/inverters/${encodeURIComponent(device.vendorDeviceId)}/live`, { headers: this.headers });
        return {
            deviceId: device.id,
            powerW: Math.round(live.acPowerW),
            exportLimitPct: live.exportLimit,
            measuredAt: new Date(live.timestamp).toISOString(),
        };
    }

    async sendCommand(device: Device, command: ControlCommand): Promise<string> {
        if (command.type !== "export_limit") {
            throw new UnsupportedCommandError(`Inverters do not support ${command.type}`);
        }
        const response = await this.client.request<{ requestId: string }>(`/api/inverters/${encodeURIComponent(device.vendorDeviceId)}/export-limit`, {
            method: "PUT",
            headers: { ...this.headers, "Content-Type": "application/json" },
            body: JSON.stringify({ maxExportPercent: command.percent }),
        });
        return response.requestId;
    }

    async commandStatus(_device: Device, reference: string): Promise<VendorCommandStatus> {
        const response = await this.client.request<{ state: string }>(`/api/requests/${encodeURIComponent(reference)}`, { headers: this.headers });
        return STATES[response.state] ?? "pending";
    }
}
