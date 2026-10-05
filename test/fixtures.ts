import { afterEach } from "vitest";

import { createHub } from "../src/container.ts";
import { fakeSunBridge, type FakeSunBridge } from "../src/fakes/sunbridgeServer.ts";
import { fakeVoltCell, type FakeVoltCell } from "../src/fakes/voltcellServer.ts";

const running: { close: () => Promise<unknown> }[] = [];

afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
});

export interface Environment {
    voltcell: FakeVoltCell;
    sunbridge: FakeSunBridge;
    hub: ReturnType<typeof createHub>;
    clock: { now: number };
}

export async function environment(options: { batteries?: number; inverters?: number; pollsUntilApplied?: number; actionTimeoutMs?: number } = {}): Promise<Environment> {
    const voltcell = fakeVoltCell(options.batteries ?? 3, options.pollsUntilApplied ?? 2);
    const sunbridge = fakeSunBridge("key-1", options.inverters ?? 2);
    const voltcellUrl = await voltcell.app.listen({ port: 0, host: "127.0.0.1" });
    const sunbridgeUrl = await sunbridge.app.listen({ port: 0, host: "127.0.0.1" });
    running.push(voltcell.app, sunbridge.app);
    const clock = { now: Date.UTC(2026, 9, 5, 7, 30) };
    const hub = createHub({
        voltcell: { baseUrl: voltcellUrl, clientId: "id", clientSecret: "secret" },
        sunbridge: { baseUrl: sunbridgeUrl, apiKey: "key-1" },
        webhookSecret: "whsec",
        actionTimeoutMs: options.actionTimeoutMs ?? 60_000,
        resilience: { baseDelayMs: 1, maxDelayMs: 5 },
        now: () => clock.now,
    });
    return { voltcell, sunbridge, hub, clock };
}
