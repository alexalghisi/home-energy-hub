import { MetricsRegistry } from "./observability/metrics.ts";
import { ActionService } from "./services/actions.ts";
import { DeviceRegistry } from "./services/deviceRegistry.ts";
import { WebhookDispatcher } from "./services/webhooks.ts";
import { ResilientClient, type ClientDependencies, type ResilienceOptions } from "./vendors/resilientClient.ts";
import { SunBridgeAdapter } from "./vendors/sunbridge.ts";
import { VoltCellAdapter } from "./vendors/voltcell.ts";

export interface HubConfig {
    voltcell: { baseUrl: string; clientId: string; clientSecret: string };
    sunbridge: { baseUrl: string; apiKey: string };
    webhookUrl?: string;
    webhookSecret: string;
    actionTimeoutMs: number;
    resilience?: Partial<ResilienceOptions>;
    clientDependencies?: ClientDependencies;
    now?: () => number;
}

export function createHub(config: HubConfig) {
    const now = config.now ?? Date.now;
    const metrics = new MetricsRegistry();
    const clients = {
        voltcell: new ResilientClient("voltcell", config.voltcell.baseUrl, metrics, config.resilience, config.clientDependencies),
        sunbridge: new ResilientClient("sunbridge", config.sunbridge.baseUrl, metrics, config.resilience, config.clientDependencies),
    };
    const registry = new DeviceRegistry([
        new VoltCellAdapter(clients.voltcell, config.voltcell, now),
        new SunBridgeAdapter(clients.sunbridge, config.sunbridge.apiKey),
    ]);
    const webhooks = new WebhookDispatcher(config.webhookUrl, config.webhookSecret, { now });
    const actions = new ActionService(registry, webhooks, { timeoutMs: config.actionTimeoutMs, now });
    return { metrics, clients, registry, webhooks, actions };
}
