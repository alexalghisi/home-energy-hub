import { describe, expect, it, vi } from "vitest";

import { VendorError } from "../src/domain/types.ts";
import { MetricsRegistry } from "../src/observability/metrics.ts";
import { ResilientClient } from "../src/vendors/resilientClient.ts";

function respond(status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ ok: status < 400 }), { status, headers });
}

function setup(responses: (Response | Error)[], options = {}) {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of responses) {
        if (response instanceof Error) {
            fetchImpl.mockRejectedValueOnce(response);
        } else {
            fetchImpl.mockResolvedValueOnce(response);
        }
    }
    const sleeps: number[] = [];
    let clock = 0;
    const metrics = new MetricsRegistry();
    const client = new ResilientClient("oem", "http://oem.test", metrics, { breakerThreshold: 2, breakerCooldownMs: 1_000, ...options }, {
        fetchImpl,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
        now: () => clock,
        random: () => 0.5,
    });
    return { client, fetchImpl, sleeps, metrics, advance: (ms: number) => (clock += ms) };
}

describe("ResilientClient", () => {
    it("retries server errors with exponential backoff", async () => {
        const { client, sleeps, metrics } = setup([respond(503), respond(502), respond(200)]);
        await expect(client.request("/x")).resolves.toEqual({ ok: true });
        expect(sleeps).toEqual([150, 300]);
        expect(metrics.for("oem").snapshot("closed")).toMatchObject({ requests: 3, retries: 2, failures: 0 });
    });

    it("waits as long as Retry-After asks when rate limited", async () => {
        const { client, sleeps, metrics } = setup([respond(429, { "retry-after": "2" }), respond(200)]);
        await client.request("/x");
        expect(sleeps).toEqual([2_000]);
        expect(metrics.for("oem").rateLimited).toBe(1);
    });

    it("does not retry client errors", async () => {
        const { client, fetchImpl } = setup([respond(404)]);
        await expect(client.request("/x")).rejects.toMatchObject({ retryable: false, message: "oem responded with HTTP 404" });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("retries network errors and gives up after the last attempt", async () => {
        const failure = new TypeError("fetch failed");
        const { client, fetchImpl } = setup([failure, failure, failure, failure], { maxAttempts: 4 });
        await expect(client.request("/x")).rejects.toThrow("oem is unreachable: fetch failed");
        expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it("opens the circuit after repeated failures and probes again after the cooldown", async () => {
        const { client, fetchImpl, metrics, advance } = setup([respond(500), respond(500), respond(200)], { maxAttempts: 1 });

        await expect(client.request("/x")).rejects.toThrow(VendorError);
        await expect(client.request("/x")).rejects.toThrow(VendorError);
        expect(client.breakerState()).toBe("open");

        await expect(client.request("/x")).rejects.toThrow("oem circuit is open");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(metrics.for("oem").shortCircuited).toBe(1);

        advance(1_000);
        expect(client.breakerState()).toBe("half_open");
        await expect(client.request("/x")).resolves.toEqual({ ok: true });
        expect(client.breakerState()).toBe("closed");
    });

    it("reopens immediately when the half-open probe fails", async () => {
        const { client, advance } = setup([respond(500), respond(500), respond(500)], { maxAttempts: 1 });
        await client.request("/x").catch(() => undefined);
        await client.request("/x").catch(() => undefined);
        advance(1_000);
        await client.request("/x").catch(() => undefined);
        expect(client.breakerState()).toBe("open");
    });
});
