import { createHub } from "./container.ts";
import { buildApp } from "./http/app.ts";

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
}

const hub = createHub({
    voltcell: {
        baseUrl: required("VOLTCELL_URL"),
        clientId: required("VOLTCELL_CLIENT_ID"),
        clientSecret: required("VOLTCELL_CLIENT_SECRET"),
    },
    sunbridge: { baseUrl: required("SUNBRIDGE_URL"), apiKey: required("SUNBRIDGE_API_KEY") },
    ...(process.env.WEBHOOK_URL ? { webhookUrl: process.env.WEBHOOK_URL } : {}),
    webhookSecret: required("WEBHOOK_SECRET"),
    actionTimeoutMs: Number(process.env.ACTION_TIMEOUT_MS ?? 120_000),
});

const app = buildApp(hub);
const reconcile = setInterval(() => void hub.actions.reconcile(), Number(process.env.RECONCILE_INTERVAL_MS ?? 5_000));
app.addHook("onClose", async () => clearInterval(reconcile));

await hub.registry.sync();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
