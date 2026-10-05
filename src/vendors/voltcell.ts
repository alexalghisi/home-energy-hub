import { UnsupportedCommandError, type ControlCommand, type Device, type Telemetry } from "../domain/types.ts";
import type { ResilientClient } from "./resilientClient.ts";
import type { VendorAdapter, VendorCommandStatus } from "./VendorAdapter.ts";

interface TokenResponse {
    access_token: string;
    expires_in: number;
}

interface BatteryPage {
    items: { serial: string; model: string }[];
    next_cursor: string | null;
}

interface BatteryStatus {
    power_kw: number;
    soc: number;
    ts: number;
}

const OPERATIONS = { charge: "CHARGE", discharge: "DISCHARGE", idle: "STANDBY" } as const;
const STATUSES: Record<string, VendorCommandStatus> = { QUEUED: "pending", APPLIED: "done", REJECTED: "failed" };

export interface VoltCellCredentials {
    clientId: string;
    clientSecret: string;
}

export class VoltCellAdapter implements VendorAdapter {
    readonly vendor = "voltcell";
    private readonly client: ResilientClient;
    private readonly credentials: VoltCellCredentials;
    private readonly now: () => number;
    private token: { value: string; expiresAt: number } | undefined;

    constructor(client: ResilientClient, credentials: VoltCellCredentials, now: () => number = Date.now) {
        this.client = client;
        this.credentials = credentials;
        this.now = now;
    }

    private async authorised(): Promise<HeadersInit> {
        if (!this.token || this.token.expiresAt - 30_000 <= this.now()) {
            const response = await this.client.request<TokenResponse>("/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: this.credentials.clientId,
                    client_secret: this.credentials.clientSecret,
                }),
            });
            this.token = { value: response.access_token, expiresAt: this.now() + response.expires_in * 1000 };
        }
        return { Authorization: `Bearer ${this.token.value}` };
    }

    async listDevices(): Promise<Device[]> {
        const devices: Device[] = [];
        let cursor: string | null = null;
        do {
            const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
            const page: BatteryPage = await this.client.request<BatteryPage>(`/v2/batteries${query}`, { headers: await this.authorised() });
            devices.push(
                ...page.items.map((item) => ({
                    id: `${this.vendor}:${item.serial}`,
                    vendor: this.vendor,
                    vendorDeviceId: item.serial,
                    kind: "battery" as const,
                    model: item.model,
                })),
            );
            cursor = page.next_cursor;
        } while (cursor);
        return devices;
    }

    async readTelemetry(device: Device): Promise<Telemetry> {
        const status = await this.client.request<BatteryStatus>(`/v2/batteries/${encodeURIComponent(device.vendorDeviceId)}/status`, {
            headers: await this.authorised(),
        });
        return {
            deviceId: device.id,
            powerW: Math.round(status.power_kw * 1000),
            stateOfChargePct: Math.round(status.soc * 1000) / 10,
            measuredAt: new Date(status.ts * 1000).toISOString(),
        };
    }

    async sendCommand(device: Device, command: ControlCommand): Promise<string> {
        if (command.type !== "battery_mode") {
            throw new UnsupportedCommandError(`Batteries do not support ${command.type}`);
        }
        const body = {
            operation: OPERATIONS[command.mode],
            ...(command.powerW === undefined ? {} : { target_kw: command.powerW / 1000 }),
        };
        const response = await this.client.request<{ command_id: string }>(`/v2/batteries/${encodeURIComponent(device.vendorDeviceId)}/commands`, {
            method: "POST",
            headers: { ...(await this.authorised()), "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return response.command_id;
    }

    async commandStatus(_device: Device, reference: string): Promise<VendorCommandStatus> {
        const response = await this.client.request<{ status: string }>(`/v2/commands/${encodeURIComponent(reference)}`, {
            headers: await this.authorised(),
        });
        return STATUSES[response.status] ?? "pending";
    }
}
