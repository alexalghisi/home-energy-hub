export interface VendorStats {
    requests: number;
    failures: number;
    retries: number;
    rateLimited: number;
    shortCircuited: number;
    latencyMsP50: number;
    latencyMsP95: number;
    breaker: "closed" | "open" | "half_open";
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Math.round(sorted[Math.max(index, 0)] ?? 0);
}

class VendorMetrics {
    requests = 0;
    failures = 0;
    retries = 0;
    rateLimited = 0;
    shortCircuited = 0;
    private readonly latencies: number[] = [];

    recordLatency(ms: number): void {
        this.latencies.push(ms);
        if (this.latencies.length > 500) {
            this.latencies.shift();
        }
    }

    snapshot(breaker: VendorStats["breaker"]): VendorStats {
        const sorted = [...this.latencies].sort((a, b) => a - b);
        return {
            requests: this.requests,
            failures: this.failures,
            retries: this.retries,
            rateLimited: this.rateLimited,
            shortCircuited: this.shortCircuited,
            latencyMsP50: percentile(sorted, 50),
            latencyMsP95: percentile(sorted, 95),
            breaker,
        };
    }
}

export class MetricsRegistry {
    private readonly vendors = new Map<string, VendorMetrics>();

    for(vendor: string): VendorMetrics {
        let metrics = this.vendors.get(vendor);
        if (!metrics) {
            metrics = new VendorMetrics();
            this.vendors.set(vendor, metrics);
        }
        return metrics;
    }

    vendorNames(): string[] {
        return [...this.vendors.keys()];
    }
}
