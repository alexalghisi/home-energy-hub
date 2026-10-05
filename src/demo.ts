import { createHub } from "./container.ts";
import { fakeSunBridge } from "./fakes/sunbridgeServer.ts";
import { fakeVoltCell } from "./fakes/voltcellServer.ts";
import { buildApp } from "./http/app.ts";

const voltcell = fakeVoltCell(3);
const sunbridge = fakeSunBridge("demo-key", 2);
const voltcellUrl = await voltcell.app.listen({ port: 0, host: "127.0.0.1" });
const sunbridgeUrl = await sunbridge.app.listen({ port: 0, host: "127.0.0.1" });

const hub = createHub({
    voltcell: { baseUrl: voltcellUrl, clientId: "demo", clientSecret: "demo" },
    sunbridge: { baseUrl: sunbridgeUrl, apiKey: "demo-key" },
    webhookSecret: "demo-secret",
    actionTimeoutMs: 60_000,
    resilience: { baseDelayMs: 50 },
});

voltcell.faults.failNext(2, { status: 503 });
sunbridge.faults.failNext(1, { status: 429, retryAfter: 0 });
await hub.registry.sync();

const devices = hub.registry.list();
await hub.actions.create(devices.find((device) => device.kind === "battery")?.id ?? "", { type: "battery_mode", mode: "charge", powerW: 3000 });
await hub.actions.create(devices.find((device) => device.kind === "battery" && device.id.endsWith("1001"))?.id ?? "", { type: "battery_mode", mode: "discharge" });
await hub.actions.create(devices.find((device) => device.kind === "inverter")?.id ?? "", { type: "export_limit", percent: 60 });
await hub.actions.reconcile();
await hub.actions.reconcile();

const app = buildApp(hub);
const address = await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
console.log(`Dashboard on ${address}`);
