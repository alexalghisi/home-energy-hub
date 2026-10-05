import { describe, expect, it } from "vitest";

import { buildApp } from "../src/http/app.ts";
import { environment } from "./fixtures.ts";

describe("HTTP API", () => {
    it("syncs devices, reads telemetry and accepts control actions", async () => {
        const { hub } = await environment();
        const app = buildApp(hub);

        const sync = await app.inject({ method: "POST", url: "/devices/sync" });
        expect(sync.json().devices).toHaveLength(5);

        const telemetry = await app.inject({ method: "GET", url: "/devices/voltcell:VC-1000/telemetry" });
        expect(telemetry.json()).toMatchObject({ powerW: 1250, stateOfChargePct: 62 });

        const action = await app.inject({ method: "POST", url: "/devices/sunbridge:SB-1/actions", payload: { type: "export_limit", percent: 70 } });
        expect(action.statusCode).toBe(202);
        expect((await app.inject({ method: "GET", url: `/actions/${action.json().id}` })).json().state).toBe("pending");
    });

    it("validates commands and maps errors to HTTP statuses", async () => {
        const { hub, voltcell } = await environment();
        const app = buildApp(hub);
        await app.inject({ method: "POST", url: "/devices/sync" });

        const invalid = await app.inject({ method: "POST", url: "/devices/sunbridge:SB-1/actions", payload: { type: "export_limit", percent: 140 } });
        expect(invalid.statusCode).toBe(422);
        const unsupported = await app.inject({ method: "POST", url: "/devices/sunbridge:SB-1/actions", payload: { type: "battery_mode", mode: "charge" } });
        expect(unsupported.statusCode).toBe(422);
        expect((await app.inject({ method: "GET", url: "/devices/nope/telemetry" })).statusCode).toBe(404);

        voltcell.faults.failNext(10, { status: 503 });
        const unavailable = await app.inject({ method: "GET", url: "/devices/voltcell:VC-1000/telemetry" });
        expect(unavailable.statusCode).toBe(503);
        expect(unavailable.json().error.code).toBe("vendor_unavailable");
    });

    it("renders the dashboard with vendor health", async () => {
        const { hub } = await environment();
        const app = buildApp(hub);
        await app.inject({ method: "POST", url: "/devices/sync" });

        const page = await app.inject({ method: "GET", url: "/" });
        expect(page.headers["content-type"]).toContain("text/html");
        expect(page.body).toContain("voltcell:VC-1000");
        expect((await app.inject({ method: "GET", url: "/vendors/health" })).json()).toHaveProperty("sunbridge.breaker", "closed");
    });
});
