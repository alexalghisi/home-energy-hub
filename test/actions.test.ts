import { describe, expect, it, vi } from "vitest";

import { WebhookDispatcher, sign, verify } from "../src/services/webhooks.ts";
import { environment } from "./fixtures.ts";

describe("control actions", () => {
    it("confirms a command once the vendor applies it", async () => {
        const { hub, sunbridge } = await environment();
        await hub.registry.sync();
        const action = await hub.actions.create("sunbridge:SB-2", { type: "export_limit", percent: 40 });
        expect(action.state).toBe("pending");

        const settled = await hub.actions.reconcile();

        expect(settled.map((item) => item.state)).toEqual(["confirmed"]);
        expect(sunbridge.exportLimit("SB-2")).toBe(40);
        expect(hub.webhooks.deliveries.map((delivery) => delivery.event)).toEqual(["action.confirmed"]);
    });

    it("stays pending until the vendor finishes, then reports rejection", async () => {
        const { hub } = await environment({ pollsUntilApplied: 3 });
        await hub.registry.sync();
        const { id } = await hub.actions.create("voltcell:VC-1000", { type: "battery_mode", mode: "discharge" });

        await hub.actions.reconcile();
        expect(hub.actions.get(id).state).toBe("pending");
        await hub.actions.reconcile();
        await hub.actions.reconcile();

        expect(hub.actions.get(id)).toMatchObject({ state: "failed", failureReason: "Vendor rejected the command" });
    });

    it("times out commands the vendor never confirms", async () => {
        const { hub, clock } = await environment({ pollsUntilApplied: 99, actionTimeoutMs: 30_000 });
        await hub.registry.sync();
        const { id } = await hub.actions.create("voltcell:VC-1000", { type: "battery_mode", mode: "charge", powerW: 2500 });

        clock.now += 30_001;
        await hub.actions.reconcile();

        expect(hub.actions.get(id).state).toBe("timed_out");
    });

    it("keeps polling when the vendor is briefly unavailable", async () => {
        const { hub, voltcell } = await environment({ pollsUntilApplied: 1 });
        await hub.registry.sync();
        const { id } = await hub.actions.create("voltcell:VC-1000", { type: "battery_mode", mode: "idle" });

        voltcell.faults.failNext(4, { status: 503 });
        await hub.actions.reconcile();
        expect(hub.actions.get(id).state).toBe("pending");

        await hub.actions.reconcile();
        expect(hub.actions.get(id).state).toBe("confirmed");
    });
});

describe("webhooks", () => {
    const now = Date.UTC(2026, 9, 5);

    it("signs payloads so receivers can verify origin and freshness", () => {
        const body = JSON.stringify({ event: "action.confirmed" });
        const header = sign("whsec", now / 1000, body);
        expect(verify("whsec", header, body, now)).toBe(true);
        expect(verify("whsec", header, body.replace("confirmed", "failed"), now)).toBe(false);
        expect(verify("other", header, body, now)).toBe(false);
        expect(verify("whsec", header, body, now + 301_000)).toBe(false);
    });

    it("retries failed deliveries with a valid signature each time", async () => {
        const fetchImpl = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response("", { status: 500 }))
            .mockResolvedValueOnce(new Response("", { status: 200 }));
        const dispatcher = new WebhookDispatcher("https://customer.test/hooks", "whsec", { fetchImpl, now: () => now });

        const delivery = await dispatcher.emit("action.confirmed", { id: "act_1" });

        expect(delivery).toMatchObject({ delivered: true, attempts: 2 });
        const [, init] = fetchImpl.mock.calls[1] ?? [];
        const headers = init?.headers as Record<string, string>;
        expect(verify("whsec", headers["X-Hub-Signature"] ?? "", String(init?.body), now)).toBe(true);
    });
});
