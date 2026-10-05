import { describe, expect, it } from "vitest";

import { UnsupportedCommandError } from "../src/domain/types.ts";
import { environment } from "./fixtures.ts";

describe("vendor adapters", () => {
    it("discovers devices across every page of both OEM clouds", async () => {
        const { hub } = await environment({ batteries: 5, inverters: 2 });
        const { devices, failedVendors } = await hub.registry.sync();
        expect(failedVendors).toEqual([]);
        expect(devices.map((device) => device.id)).toEqual([
            "sunbridge:SB-1",
            "sunbridge:SB-2",
            "voltcell:VC-1000",
            "voltcell:VC-1001",
            "voltcell:VC-1002",
            "voltcell:VC-1003",
            "voltcell:VC-1004",
        ]);
    });

    it("normalises units and timestamps into one telemetry shape", async () => {
        const { hub } = await environment();
        await hub.registry.sync();
        const battery = hub.registry.resolve("voltcell:VC-1001");
        const inverter = hub.registry.resolve("sunbridge:SB-1");

        expect(await battery.adapter.readTelemetry(battery.device)).toEqual({
            deviceId: "voltcell:VC-1001",
            powerW: 2250,
            stateOfChargePct: 63,
            measuredAt: "2026-10-05T11:33:20.000Z",
        });
        expect(await inverter.adapter.readTelemetry(inverter.device)).toEqual({
            deviceId: "sunbridge:SB-1",
            powerW: 3120,
            exportLimitPct: 100,
            measuredAt: "2026-10-05T07:30:00.000Z",
        });
    });

    it("reuses the OAuth token until it is about to expire", async () => {
        const { hub, voltcell, clock } = await environment();
        await hub.registry.sync();
        const { device, adapter } = hub.registry.resolve("voltcell:VC-1000");
        await adapter.readTelemetry(device);
        expect(voltcell.tokensIssued()).toBe(1);

        clock.now += 3_571_000;
        await adapter.readTelemetry(device);
        expect(voltcell.tokensIssued()).toBe(2);
    });

    it("rejects commands a device type cannot perform", async () => {
        const { hub } = await environment();
        await hub.registry.sync();
        const { device, adapter } = hub.registry.resolve("sunbridge:SB-1");
        await expect(adapter.sendCommand(device, { type: "battery_mode", mode: "charge" })).rejects.toThrow(UnsupportedCommandError);
    });

    it("keeps devices from healthy vendors when one vendor is down", async () => {
        const { hub, sunbridge } = await environment();
        sunbridge.faults.failNext(20, { status: 503 });
        const { devices, failedVendors } = await hub.registry.sync();
        expect(failedVendors).toEqual([{ vendor: "sunbridge", reason: "sunbridge responded with HTTP 503" }]);
        expect(devices.every((device) => device.vendor === "voltcell")).toBe(true);
    });
});
