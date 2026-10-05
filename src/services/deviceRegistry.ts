import type { Device } from "../domain/types.ts";
import type { VendorAdapter } from "../vendors/VendorAdapter.ts";

export class DeviceNotFoundError extends Error {}

export interface DeviceSyncResult {
    devices: Device[];
    failedVendors: { vendor: string; reason: string }[];
}

export class DeviceRegistry {
    private readonly adapters: Map<string, VendorAdapter>;
    private readonly devices = new Map<string, Device>();

    constructor(adapters: VendorAdapter[]) {
        this.adapters = new Map(adapters.map((adapter) => [adapter.vendor, adapter]));
    }

    async sync(): Promise<DeviceSyncResult> {
        const results = await Promise.allSettled([...this.adapters.values()].map(async (adapter) => ({ adapter, devices: await adapter.listDevices() })));
        const failedVendors: DeviceSyncResult["failedVendors"] = [];
        results.forEach((result, index) => {
            const vendor = [...this.adapters.keys()][index] ?? "unknown";
            if (result.status === "fulfilled") {
                for (const device of result.value.devices) {
                    this.devices.set(device.id, device);
                }
            } else {
                failedVendors.push({ vendor, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
            }
        });
        return { devices: this.list(), failedVendors };
    }

    list(): Device[] {
        return [...this.devices.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    resolve(deviceId: string): { device: Device; adapter: VendorAdapter } {
        const device = this.devices.get(deviceId);
        const adapter = device ? this.adapters.get(device.vendor) : undefined;
        if (!device || !adapter) {
            throw new DeviceNotFoundError(`Device ${deviceId} not found`);
        }
        return { device, adapter };
    }
}
