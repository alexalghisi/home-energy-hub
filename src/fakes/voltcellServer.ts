import Fastify, { type FastifyInstance } from "fastify";

import { FaultPlan } from "./faults.ts";

interface Command {
    operation: string;
    polls: number;
}

export interface FakeVoltCell {
    app: FastifyInstance;
    faults: FaultPlan;
    tokensIssued: () => number;
}

export function fakeVoltCell(batteryCount = 3, pollsUntilApplied = 2): FakeVoltCell {
    const app = Fastify();
    const faults = new FaultPlan();
    const commands = new Map<string, Command>();
    const serials = Array.from({ length: batteryCount }, (_, index) => `VC-${1000 + index}`);
    let tokens = 0;

    app.addHook("onRequest", async (request, reply) => {
        const fault = faults.take();
        if (fault) {
            if (fault.retryAfter !== undefined) {
                void reply.header("retry-after", String(fault.retryAfter));
            }
            return reply.status(fault.status).send({ error: "injected" });
        }
        if (request.url !== "/oauth/token" && !request.headers.authorization?.startsWith("Bearer token-")) {
            return reply.status(401).send({ error: "unauthorised" });
        }
        return undefined;
    });

    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, body));

    app.post("/oauth/token", async () => {
        tokens += 1;
        return { access_token: `token-${tokens}`, expires_in: 3600 };
    });

    app.get<{ Querystring: { cursor?: string } }>("/v2/batteries", async (request) => {
        const start = Number(request.query.cursor ?? 0);
        const items = serials.slice(start, start + 2).map((serial) => ({ serial, model: "VoltCell Home 13" }));
        return { items, next_cursor: start + 2 < serials.length ? String(start + 2) : null };
    });

    app.get<{ Params: { serial: string } }>("/v2/batteries/:serial/status", async (request, reply) => {
        const index = serials.indexOf(request.params.serial);
        if (index < 0) {
            return reply.status(404).send({ error: "unknown battery" });
        }
        return { power_kw: 1.25 + index, soc: 0.62 + index / 100, ts: 1_791_200_000 };
    });

    app.post<{ Params: { serial: string }; Body: { operation: string } }>("/v2/batteries/:serial/commands", async (request) => {
        const id = `cmd-${commands.size + 1}`;
        commands.set(id, { operation: request.body.operation, polls: 0 });
        return { command_id: id };
    });

    app.get<{ Params: { id: string } }>("/v2/commands/:id", async (request, reply) => {
        const command = commands.get(request.params.id);
        if (!command) {
            return reply.status(404).send({ error: "unknown command" });
        }
        command.polls += 1;
        if (command.operation === "DISCHARGE" && command.polls >= pollsUntilApplied) {
            return { status: "REJECTED", reason: "reserve below threshold" };
        }
        return { status: command.polls >= pollsUntilApplied ? "APPLIED" : "QUEUED" };
    });

    return { app, faults, tokensIssued: () => tokens };
}
