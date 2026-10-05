import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookDelivery {
    event: string;
    payload: unknown;
    attempts: number;
    delivered: boolean;
    lastError?: string;
}

export function sign(secret: string, timestamp: number, body: string): string {
    const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return `t=${timestamp},v1=${digest}`;
}

export function verify(secret: string, header: string, body: string, now: number, toleranceSeconds = 300): boolean {
    const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > toleranceSeconds || !parts.v1) {
        return false;
    }
    const expected = Buffer.from(sign(secret, timestamp, body).split("v1=")[1] ?? "");
    const received = Buffer.from(parts.v1);
    return expected.length === received.length && timingSafeEqual(expected, received);
}

export class WebhookDispatcher {
    private readonly url: string | undefined;
    private readonly secret: string;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly maxAttempts: number;
    readonly deliveries: WebhookDelivery[] = [];

    constructor(url: string | undefined, secret: string, deps: { fetchImpl?: typeof fetch; now?: () => number; maxAttempts?: number } = {}) {
        this.url = url;
        this.secret = secret;
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.now = deps.now ?? Date.now;
        this.maxAttempts = deps.maxAttempts ?? 3;
    }

    async emit(event: string, payload: unknown): Promise<WebhookDelivery> {
        const delivery: WebhookDelivery = { event, payload, attempts: 0, delivered: false };
        this.deliveries.push(delivery);
        if (!this.url) {
            return delivery;
        }
        const body = JSON.stringify({ event, data: payload });
        while (!delivery.delivered && delivery.attempts < this.maxAttempts) {
            delivery.attempts += 1;
            try {
                const response = await this.fetchImpl(this.url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Hub-Signature": sign(this.secret, Math.floor(this.now() / 1000), body) },
                    body,
                    signal: AbortSignal.timeout(5_000),
                });
                delivery.delivered = response.ok;
                if (!response.ok) {
                    delivery.lastError = `HTTP ${response.status}`;
                }
            } catch (error) {
                delivery.lastError = error instanceof Error ? error.message : String(error);
            }
        }
        return delivery;
    }
}
