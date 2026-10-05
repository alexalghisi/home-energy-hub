import { VendorError } from "../domain/types.ts";
import type { MetricsRegistry } from "../observability/metrics.ts";

export interface ResilienceOptions {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    timeoutMs: number;
    breakerThreshold: number;
    breakerCooldownMs: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
    maxAttempts: 4,
    baseDelayMs: 200,
    maxDelayMs: 5_000,
    timeoutMs: 10_000,
    breakerThreshold: 5,
    breakerCooldownMs: 30_000,
};

export interface ClientDependencies {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
}

type BreakerState = "closed" | "open" | "half_open";

export class ResilientClient {
    private readonly vendor: string;
    private readonly baseUrl: string;
    private readonly options: ResilienceOptions;
    private readonly metrics: MetricsRegistry;
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;
    private readonly random: () => number;
    private consecutiveFailures = 0;
    private openedAt: number | undefined;

    constructor(vendor: string, baseUrl: string, metrics: MetricsRegistry, options: Partial<ResilienceOptions> = {}, deps: ClientDependencies = {}) {
        this.vendor = vendor;
        this.baseUrl = baseUrl;
        this.metrics = metrics;
        this.options = { ...DEFAULT_RESILIENCE, ...options };
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.now = deps.now ?? Date.now;
        this.random = deps.random ?? Math.random;
    }

    breakerState(): BreakerState {
        if (this.openedAt === undefined) {
            return "closed";
        }
        return this.now() - this.openedAt >= this.options.breakerCooldownMs ? "half_open" : "open";
    }

    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const stats = this.metrics.for(this.vendor);
        if (this.breakerState() === "open") {
            stats.shortCircuited += 1;
            throw new VendorError(`${this.vendor} circuit is open`, true);
        }
        for (let attempt = 1; ; attempt += 1) {
            stats.requests += 1;
            const started = this.now();
            try {
                const response = await this.fetchImpl(new URL(path, this.baseUrl), {
                    ...init,
                    signal: AbortSignal.timeout(this.options.timeoutMs),
                });
                stats.recordLatency(this.now() - started);
                if (response.ok) {
                    this.onSuccess();
                    return (await response.json()) as T;
                }
                const retryable = response.status === 429 || response.status >= 500;
                if (response.status === 429) {
                    stats.rateLimited += 1;
                }
                if (!retryable || attempt >= this.options.maxAttempts) {
                    throw new VendorError(`${this.vendor} responded with HTTP ${response.status}`, retryable);
                }
                stats.retries += 1;
                await this.sleep(this.delay(attempt, response.headers.get("retry-after")));
            } catch (error) {
                if (error instanceof VendorError) {
                    this.onFailure(error.retryable);
                    throw error;
                }
                stats.recordLatency(this.now() - started);
                if (attempt >= this.options.maxAttempts) {
                    this.onFailure(true);
                    throw new VendorError(`${this.vendor} is unreachable: ${(error as Error).message}`, true);
                }
                stats.retries += 1;
                await this.sleep(this.delay(attempt, null));
            }
        }
    }

    private delay(attempt: number, retryAfter: string | null): number {
        const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, this.options.maxDelayMs);
        }
        const exponential = this.options.baseDelayMs * 2 ** (attempt - 1);
        return Math.min(exponential / 2 + this.random() * (exponential / 2), this.options.maxDelayMs);
    }

    private onSuccess(): void {
        this.consecutiveFailures = 0;
        this.openedAt = undefined;
    }

    private onFailure(countsTowardsBreaker: boolean): void {
        this.metrics.for(this.vendor).failures += 1;
        if (!countsTowardsBreaker) {
            return;
        }
        this.consecutiveFailures += 1;
        if (this.breakerState() === "half_open" || this.consecutiveFailures >= this.options.breakerThreshold) {
            this.openedAt = this.now();
        }
    }
}
