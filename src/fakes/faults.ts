export interface Fault {
    status: number;
    retryAfter?: number;
}

export class FaultPlan {
    private readonly queue: Fault[] = [];

    failNext(count: number, fault: Fault): this {
        for (let index = 0; index < count; index += 1) {
            this.queue.push(fault);
        }
        return this;
    }

    take(): Fault | undefined {
        return this.queue.shift();
    }
}
