import Fastify, { type FastifyInstance } from "fastify";

import { FaultPlan } from "./faults.ts";

export interface FakeSunBridge {
    app: FastifyInstance;
    faults: FaultPlan;
    exportLimit: (id: string) => number | undefined;
}

export function fakeSunBridge(apiKey: string, inverterCount = 2, pollsUntilDone = 1): FakeSunBridge {
    const app = Fastify();
    const faults = new FaultPlan();
    const limits = new Map(Array.from({ length: inverterCount }, (_, index) => [`SB-${index + 1}`, 100]));
    const requests = new Map<string, { polls: number; inverter: string; percent: number }>();

    app.addHook("onRequest", async (request, reply) => {
        const fault = faults.take();
        if (fault) {
            if (fault.retryAfter !== undefined) {
                void reply.header("retry-after", String(fault.retryAfter));
            }
            return reply.status(fault.status).send({ error: "injected" });
        }
        if (request.headers["x-api-key"] !== apiKey) {
            return reply.status(403).send({ error: "bad api key" });
        }
        return undefined;
    });

    app.get<{ Querystring: { page: string; size: string } }>("/api/inverters", async (request) => {
        const page = Number(request.query.page);
        const size = Number(request.query.size);
        const ids = [...limits.keys()];
        return { data: ids.slice(page * size, page * size + size).map((id) => ({ id, sku: "SunBridge X5" })), total: ids.length };
    });

    app.get<{ Params: { id: string } }>("/api/inverters/:id/live", async (request, reply) => {
        const limit = limits.get(request.params.id);
        if (limit === undefined) {
            return reply.status(404).send({ error: "unknown inverter" });
        }
        return { acPowerW: 3120.4 * (limit / 100), exportLimit: limit, timestamp: "2026-10-05T07:30:00Z" };
    });

    app.put<{ Params: { id: string }; Body: { maxExportPercent: number } }>("/api/inverters/:id/export-limit", async (request, reply) => {
        if (!limits.has(request.params.id)) {
            return reply.status(404).send({ error: "unknown inverter" });
        }
        const requestId = `req-${requests.size + 1}`;
        requests.set(requestId, { polls: 0, inverter: request.params.id, percent: request.body.maxExportPercent });
        return { requestId };
    });

    app.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
        const pending = requests.get(request.params.id);
        if (!pending) {
            return reply.status(404).send({ error: "unknown request" });
        }
        pending.polls += 1;
        if (pending.polls < pollsUntilDone) {
            return { state: "IN_PROGRESS" };
        }
        limits.set(pending.inverter, pending.percent);
        return { state: "SUCCEEDED" };
    });

    return { app, faults, exportLimit: (id) => limits.get(id) };
}
