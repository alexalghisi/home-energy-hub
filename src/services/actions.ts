import { randomUUID } from "node:crypto";

import type { Action, ControlCommand } from "../domain/types.ts";
import type { DeviceRegistry } from "./deviceRegistry.ts";
import type { WebhookDispatcher } from "./webhooks.ts";

export class ActionNotFoundError extends Error {}

export interface ActionServiceOptions {
    timeoutMs: number;
    now: () => number;
}

export class ActionService {
    private readonly registry: DeviceRegistry;
    private readonly webhooks: WebhookDispatcher;
    private readonly options: ActionServiceOptions;
    private readonly actions = new Map<string, Action>();

    constructor(registry: DeviceRegistry, webhooks: WebhookDispatcher, options: ActionServiceOptions) {
        this.registry = registry;
        this.webhooks = webhooks;
        this.options = options;
    }

    private stamp(): string {
        return new Date(this.options.now()).toISOString();
    }

    async create(deviceId: string, command: ControlCommand): Promise<Action> {
        const { device, adapter } = this.registry.resolve(deviceId);
        const vendorReference = await adapter.sendCommand(device, command);
        const action: Action = {
            id: `act_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
            deviceId,
            command,
            state: "pending",
            vendorReference,
            createdAt: this.stamp(),
            updatedAt: this.stamp(),
        };
        this.actions.set(action.id, action);
        return { ...action };
    }

    get(actionId: string): Action {
        const action = this.actions.get(actionId);
        if (!action) {
            throw new ActionNotFoundError(`Action ${actionId} not found`);
        }
        return { ...action };
    }

    list(): Action[] {
        return [...this.actions.values()].map((action) => ({ ...action }));
    }

    async reconcile(): Promise<Action[]> {
        const settled: Action[] = [];
        for (const action of this.actions.values()) {
            if (action.state !== "pending" || !action.vendorReference) {
                continue;
            }
            if (this.options.now() - Date.parse(action.createdAt) > this.options.timeoutMs) {
                this.settle(action, "timed_out", "Vendor did not confirm in time");
            } else {
                const { device, adapter } = this.registry.resolve(action.deviceId);
                try {
                    const status = await adapter.commandStatus(device, action.vendorReference);
                    if (status === "done") {
                        this.settle(action, "confirmed");
                    } else if (status === "failed") {
                        this.settle(action, "failed", "Vendor rejected the command");
                    }
                } catch {
                    continue;
                }
            }
            if (action.state !== "pending") {
                settled.push({ ...action });
                await this.webhooks.emit(`action.${action.state}`, action);
            }
        }
        return settled;
    }

    private settle(action: Action, state: Action["state"], reason?: string): void {
        action.state = state;
        action.updatedAt = this.stamp();
        if (reason) {
            action.failureReason = reason;
        }
    }
}
