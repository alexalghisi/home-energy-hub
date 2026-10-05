import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { UnsupportedCommandError, VendorError, type Telemetry } from "../domain/types.ts";
import type { MetricsRegistry } from "../observability/metrics.ts";
import { ActionNotFoundError, type ActionService } from "../services/actions.ts";
import { DeviceNotFoundError, type DeviceRegistry } from "../services/deviceRegistry.ts";
import type { ResilientClient } from "../vendors/resilientClient.ts";
import { renderDashboard } from "./dashboard.ts";

const command = z.discriminatedUnion("type", [
    z.object({ type: z.literal("battery_mode"), mode: z.enum(["charge", "discharge", "idle"]), powerW: z.number().int().positive().max(20_000).optional() }),
    z.object({ type: z.literal("export_limit"), percent: z.number().int().min(0).max(100) }),
]);

export interface AppDependencies {
    registry: DeviceRegistry;
    actions: ActionService;
    metrics: MetricsRegistry;
    clients: Record<string, ResilientClient>;
}

export function buildApp({ registry, actions, metrics, clients }: AppDependencies): FastifyInstance {
    const app = Fastify();

    function vendorStats() {
        return Object.fromEntries(Object.entries(clients).map(([vendor, client]) => [vendor, metrics.for(vendor).snapshot(client.breakerState())]));
    }

    async function readAll(): Promise<Map<string, Telemetry>> {
        const readings = await Promise.allSettled(
            registry.list().map(async (device) => {
                const { adapter } = registry.resolve(device.id);
                return adapter.readTelemetry(device);
            }),
        );
        return new Map(readings.flatMap((reading) => (reading.status === "fulfilled" ? [[reading.value.deviceId, reading.value] as const] : [])));
    }

    app.setErrorHandler((error, _request, reply) => {
        if (error instanceof DeviceNotFoundError || error instanceof ActionNotFoundError) {
            return reply.status(404).send({ error: { code: "not_found", message: error.message } });
        }
        if (error instanceof UnsupportedCommandError || error instanceof z.ZodError) {
            return reply.status(422).send({ error: { code: "invalid_command", message: error.message } });
        }
        if (error instanceof VendorError) {
            return reply.status(error.retryable ? 503 : 502).send({ error: { code: "vendor_unavailable", message: error.message } });
        }
        return reply.status(500).send({ error: { code: "internal", message: "Unexpected error" } });
    });

    app.post("/devices/sync", async () => registry.sync());
    app.get("/devices", async () => registry.list());

    app.get<{ Params: { deviceId: string } }>("/devices/:deviceId/telemetry", async (request) => {
        const { device, adapter } = registry.resolve(request.params.deviceId);
        return adapter.readTelemetry(device);
    });

    app.post<{ Params: { deviceId: string } }>("/devices/:deviceId/actions", async (request, reply) => {
        const action = await actions.create(request.params.deviceId, command.parse(request.body));
        return reply.status(202).send(action);
    });

    app.get<{ Params: { actionId: string } }>("/actions/:actionId", async (request) => actions.get(request.params.actionId));
    app.get("/vendors/health", async () => vendorStats());

    app.get("/", async (_request, reply) => {
        const telemetry = await readAll();
        return reply.type("text/html").send(renderDashboard(registry.list(), telemetry, vendorStats(), actions.list()));
    });

    return app;
}
