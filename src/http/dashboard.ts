import type { Action, Device, Telemetry } from "../domain/types.ts";
import type { VendorStats } from "../observability/metrics.ts";

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function deviceRow(device: Device, telemetry: Telemetry | undefined): string {
    const detail = telemetry
        ? device.kind === "battery"
            ? `${telemetry.stateOfChargePct ?? "–"}% charged`
            : `export limit ${telemetry.exportLimitPct ?? "–"}%`
        : "unavailable";
    const power = telemetry ? `${(telemetry.powerW / 1000).toFixed(2)} kW` : "–";
    return `<tr><td><span class="kind ${device.kind}">${device.kind}</span></td><td>${escapeHtml(device.id)}</td><td>${escapeHtml(device.model)}</td><td class="num">${power}</td><td>${escapeHtml(detail)}</td></tr>`;
}

function vendorCard(vendor: string, stats: VendorStats): string {
    const success = stats.requests ? Math.round(((stats.requests - stats.failures) / stats.requests) * 100) : 100;
    return `<div class="vendor"><h3>${escapeHtml(vendor)} <span class="breaker ${stats.breaker}">${stats.breaker.replace("_", " ")}</span></h3>
<dl><dt>success</dt><dd>${success}%</dd><dt>requests</dt><dd>${stats.requests}</dd><dt>retries</dt><dd>${stats.retries}</dd>
<dt>rate limited</dt><dd>${stats.rateLimited}</dd><dt>p50 / p95</dt><dd>${stats.latencyMsP50} / ${stats.latencyMsP95} ms</dd></dl></div>`;
}

function actionRow(action: Action): string {
    const command = action.command.type === "battery_mode" ? `battery → ${action.command.mode}` : `export limit → ${action.command.percent}%`;
    return `<tr><td>${escapeHtml(action.id)}</td><td>${escapeHtml(action.deviceId)}</td><td>${escapeHtml(command)}</td><td><span class="state ${action.state}">${action.state.replace("_", " ")}</span></td><td>${escapeHtml(action.failureReason ?? "")}</td></tr>`;
}

export function renderDashboard(
    devices: Device[],
    telemetry: Map<string, Telemetry>,
    vendors: Record<string, VendorStats>,
    actions: Action[],
): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home energy hub</title><style>
body{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;background:#f3f6f4;color:#14231b}
header{padding:20px 28px;background:#0f3d2e;color:#fff}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:#b9d7c8;font-size:13px}
main{padding:24px 28px;display:grid;gap:24px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#4d6358;margin:0 0 10px}
.vendors{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.vendor{background:#fff;border:1px solid #dde6e1;border-radius:12px;padding:12px 16px}.vendor h3{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:13px}dt{color:#4d6358}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.breaker{font-size:11px;padding:2px 8px;border-radius:99px;background:#e2f5ea;color:#16703f}.breaker.open{background:#fde7e7;color:#a32020}.breaker.half_open{background:#fff3d6;color:#8a5a00}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde6e1;border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #edf2ef}th{background:#f7faf8;color:#4d6358;font-weight:600}.num{font-variant-numeric:tabular-nums}
.kind,.state{font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600}.kind.battery{background:#e7efff;color:#2949a8}.kind.inverter{background:#fff3d6;color:#8a5a00}
.state.confirmed{background:#e2f5ea;color:#16703f}.state.pending{background:#eef1f4;color:#4d5866}.state.failed,.state.timed_out{background:#fde7e7;color:#a32020}
</style></head><body><header><h1>Home energy hub</h1><p>${devices.length} devices across ${Object.keys(vendors).length} OEM clouds</p></header><main>
<section><h2>Vendor health</h2><div class="vendors">${Object.entries(vendors).map(([vendor, stats]) => vendorCard(vendor, stats)).join("")}</div></section>
<section><h2>Devices</h2><table><thead><tr><th>Kind</th><th>Device</th><th>Model</th><th>Power</th><th>State</th></tr></thead><tbody>${devices.map((device) => deviceRow(device, telemetry.get(device.id))).join("")}</tbody></table></section>
<section><h2>Control actions</h2><table><thead><tr><th>Action</th><th>Device</th><th>Command</th><th>State</th><th>Reason</th></tr></thead><tbody>${actions.map(actionRow).join("")}</tbody></table></section>
</main></body></html>`;
}
