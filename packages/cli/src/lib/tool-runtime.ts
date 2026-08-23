import type { ModeType } from "@more-more-code/shared";
import {
    ApprovalCancelledError,
    isApprovalResolution,
    isPermissionDecision,
    type ApprovalBroker,
    type ApprovalRequest,
    type PermissionDecision,
    type PermissionEffect,
    type PermissionPolicy,
    type PermissionRequest,
    type PermissionResourceKind,
    type PermissionScope,
} from "@more-more-code/harness";
import type { RegisteredToolDefinition, ToolRegistry, ToolSourceKind } from "./tool-registry";

export type ToolExecutionStatus = "completed" | "failed" | "cancelled" | "timed_out" | "denied" | "approval_required";

export type ToolExecutionContext = {
    sessionId: string;
    runId: string;
    turnId: string;
    stepId: string;
    toolCallId: string;
    workspaceRoot: string;
    mode: ModeType;
    signal: AbortSignal;
    timeoutMs?: number;
};

export type ToolExecutionRequest = {
    toolName: string;
    input: unknown;
    source?: ToolSourceKind;
    context: ToolExecutionContext;
};

export type ToolExecutor = {
    source: ToolSourceKind;
    execute(toolName: string, input: unknown, context: ToolExecutionContext): Promise<unknown>;
    resolveTimeoutMs?(toolName: string, input: unknown, context: ToolExecutionContext): number | undefined;
};

export type ToolExecutionResult = {
    toolName: string;
    source: ToolSourceKind;
    status: ToolExecutionStatus;
    output?: unknown;
    error?: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
};

export type ToolRuntimeOptions = {
    registry: ToolRegistry;
    executors: ToolExecutor[];
    permissionPolicy: PermissionPolicy;
    approvalBroker: ApprovalBroker;
    approvalTimeoutMs?: number;
    defaultTimeoutMs?: number;
    now?: () => number;
    observer?: ToolRuntimeObserver;
};

export type ToolRuntimeApprovalRequirement = {
    capability: string;
    resourceKind: PermissionResourceKind;
    scope: PermissionScope;
};

export type ToolRuntimeObserverEvent =
    | {
        type: "tool_requested";
        toolName: string;
        source: ToolSourceKind;
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "permission_requested";
        toolName: string;
        capability: string;
        resourceKind: PermissionResourceKind;
        scope: PermissionScope;
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "permission_decided";
        toolName: string;
        capability: string;
        resourceKind: PermissionResourceKind;
        scope: PermissionScope;
        decision: PermissionEffect;
        policy: "default" | "configured";
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "approval_requested";
        approvalId: string;
        toolName: string;
        requirements: ToolRuntimeApprovalRequirement[];
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "approval_resolved";
        approvalId: string;
        toolName: string;
        requirements: ToolRuntimeApprovalRequirement[];
        decision: "allow" | "deny";
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "approval_cancelled";
        approvalId: string;
        toolName: string;
        requirements: ToolRuntimeApprovalRequirement[];
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "approval_timed_out";
        approvalId: string;
        toolName: string;
        requirements: ToolRuntimeApprovalRequirement[];
        context: ToolRuntimeObservationContext;
    }
    | {
        type: "tool_completed";
        result: Omit<ToolExecutionResult, "output" | "error">;
        context: ToolRuntimeObservationContext;
    };

export type ToolRuntimeObservationContext = Pick<
    ToolExecutionContext,
    "sessionId" | "runId" | "turnId" | "stepId" | "toolCallId" | "mode"
>;

export type ToolRuntimeObserver = (
    event: ToolRuntimeObserverEvent,
) => void | Promise<void>;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function finishResult(
    base: Omit<ToolExecutionResult, "completedAt" | "durationMs">,
    now: () => number,
): ToolExecutionResult {
    const completedAt = now();
    return {
        ...base,
        completedAt,
        durationMs: Math.max(0, completedAt - base.startedAt),
    };
}

/** Local boundary for tool visibility, policy, cancellation, timeout and execution outcomes. */
export class ToolRuntime {
    private readonly registry: ToolRegistry;
    private readonly executors: Map<ToolSourceKind, ToolExecutor>;
    private readonly permissionPolicy: PermissionPolicy;
    private readonly approvalBroker: ApprovalBroker;
    private readonly approvalTimeoutMs: number;
    private readonly defaultTimeoutMs: number;
    private readonly now: () => number;
    private readonly observer?: ToolRuntimeObserver;

    constructor(options: ToolRuntimeOptions) {
        this.registry = options.registry;
        this.executors = new Map(options.executors.map((executor) => [executor.source, executor]));
        this.permissionPolicy = options.permissionPolicy;
        this.approvalBroker = options.approvalBroker;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? 5 * 60_000;
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
        this.now = options.now ?? Date.now;
        this.observer = options.observer;
    }

    async run(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        const source = request.source ?? "native";
        const startedAt = this.now();
        const base = { toolName: request.toolName, source, startedAt } as const;

        if (request.context.signal.aborted) {
            return finishResult({ ...base, status: "cancelled", error: "Tool execution was cancelled" }, this.now);
        }

        await this.observe({
            type: "tool_requested",
            toolName: request.toolName,
            source,
            context: redactToolExecutionContext(request.context),
        });

        const tool = this.registry.getToolDefinition(request.toolName, request.context.mode, source);
        if (!tool) {
            return this.finishAndObserve(request.context, {
                ...base,
                status: "denied",
                error: `Tool ${request.toolName} is not available in ${request.context.mode} mode`,
            });
        }

        const permission = await this.evaluatePermissions(tool, request);
        if (permission.denied) {
            return this.finishAndObserve(request.context, {
                ...base,
                status: "denied",
                error: permission.denied.reason ?? `Permission denied for tool ${request.toolName}`,
            });
        }
        if (permission.asks.length > 0) {
            const approval = await this.awaitApproval(tool, permission.asks, request);
            if (approval === "deny") {
                return this.finishAndObserve(request.context, {
                    ...base,
                    status: "denied",
                    error: `Approval denied for tool ${request.toolName}`,
                });
            }
            if (approval === "cancelled") {
                return this.finishAndObserve(request.context, {
                    ...base,
                    status: "cancelled",
                    error: `Approval cancelled for tool ${request.toolName}`,
                });
            }
            if (approval === "timed_out") {
                return this.finishAndObserve(request.context, {
                    ...base,
                    status: "timed_out",
                    error: `Approval timed out for tool ${request.toolName}`,
                });
            }
        }

        // Permission evaluation may be async. Re-check before installing the
        // executor abort bridge so an interrupt cannot be lost in that gap.
        if (request.context.signal.aborted) {
            return this.finishAndObserve(request.context, {
                ...base,
                status: "cancelled",
                error: "Tool execution was cancelled",
            });
        }

        const executor = this.executors.get(source);
        if (!executor) {
            return this.finishAndObserve(request.context, {
                ...base,
                status: "failed",
                error: `No executor is registered for tool source ${source}`,
            });
        }

        const result = await this.executeWithLifecycle(request, executor, base);
        await this.observe({
            type: "tool_completed",
            result: redactToolExecutionResult(result),
            context: redactToolExecutionContext(request.context),
        });
        return result;
    }

    private async evaluatePermissions(
        tool: RegisteredToolDefinition,
        request: ToolExecutionRequest,
    ): Promise<{
        denied: PermissionDecision | null;
        asks: PermissionRequest[];
    }> {
        const permissionRequests = await this.registry.getPermissionRequests(
            tool,
            request.input,
            request.context.workspaceRoot,
        );
        let denied: PermissionDecision | null = null;
        const asks: PermissionRequest[] = [];

        for (const permissionRequest of permissionRequests) {
            const resource = permissionRequest.resource ?? {
                kind: "resource" as const,
                value: `tool:${request.toolName}`,
                scope: "workspace" as const,
            };
            const normalizedRequest: PermissionRequest = {
                capability: permissionRequest.capability,
                resource,
            };
            const observation = {
                toolName: request.toolName,
                capability: permissionRequest.capability,
                resourceKind: resource.kind,
                scope: resource.scope,
                context: redactToolExecutionContext(request.context),
            };
            await this.observe({
                type: "permission_requested",
                ...observation,
            });
            const decision = await this.permissionPolicy.decide(normalizedRequest);
            if (!isPermissionDecision(decision)) {
                throw new Error("Permission policy returned an invalid decision");
            }
            await this.observe({
                type: "permission_decided",
                ...observation,
                decision: decision.effect,
                policy: decision.policy,
            });

            if (decision.effect === "deny") denied ??= decision;
            if (decision.effect === "ask") asks.push(normalizedRequest);
        }

        return { denied, asks };
    }

    private async awaitApproval(
        tool: RegisteredToolDefinition,
        requirements: PermissionRequest[],
        request: ToolExecutionRequest,
    ): Promise<"allow" | "deny" | "cancelled" | "timed_out"> {
        if (request.context.signal.aborted) return "cancelled";

        const approvalId = crypto.randomUUID();
        const observationRequirements = requirements.map((requirement) => {
            const resource = requirement.resource!;
            return {
                capability: requirement.capability,
                resourceKind: resource.kind,
                scope: resource.scope,
            };
        });
        const observation = {
            approvalId,
            toolName: request.toolName,
            requirements: observationRequirements,
            context: redactToolExecutionContext(request.context),
        };

        await this.observe({
            type: "approval_requested",
            ...observation,
        });

        const controller = new AbortController();
        let timedOut = false;
        const propagateAbort = () => controller.abort(request.context.signal.reason);
        request.context.signal.addEventListener("abort", propagateAbort, { once: true });
        const timer = this.approvalTimeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                controller.abort(new Error(`Approval timed out after ${this.approvalTimeoutMs}ms`));
            }, this.approvalTimeoutMs)
            : null;

        const approvalRequest: ApprovalRequest = {
            approvalId,
            sessionId: request.context.sessionId,
            runId: request.context.runId,
            turnId: request.context.turnId,
            stepId: request.context.stepId,
            toolCallId: request.context.toolCallId,
            toolName: tool.name,
            requirements,
        };

        try {
            const brokerPromise = this.approvalBroker.request(approvalRequest, {
                signal: controller.signal,
            });
            const resolution = await awaitWithAbort(brokerPromise, controller.signal);
            if (!isApprovalResolution(resolution)) {
                throw new Error("Approval broker returned an invalid resolution");
            }
            await this.observe({
                type: "approval_resolved",
                ...observation,
                decision: resolution.decision,
            });
            return resolution.decision;
        } catch (error) {
            if (timedOut) {
                await this.observe({
                    type: "approval_timed_out",
                    ...observation,
                });
                return "timed_out";
            }
            if (request.context.signal.aborted || error instanceof ApprovalCancelledError) {
                await this.observe({
                    type: "approval_cancelled",
                    ...observation,
                });
                return "cancelled";
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
            request.context.signal.removeEventListener("abort", propagateAbort);
        }
    }

    private async finishAndObserve(
        context: ToolExecutionContext,
        base: Omit<ToolExecutionResult, "completedAt" | "durationMs">,
    ): Promise<ToolExecutionResult> {
        const result = finishResult(base, this.now);
        await this.observe({
            type: "tool_completed",
            result: redactToolExecutionResult(result),
            context: redactToolExecutionContext(context),
        });
        return result;
    }

    private async observe(event: ToolRuntimeObserverEvent): Promise<void> {
        await this.observer?.(event);
    }

    private async executeWithLifecycle(
        request: ToolExecutionRequest,
        executor: ToolExecutor,
        base: { toolName: string; source: ToolSourceKind; startedAt: number },
    ): Promise<ToolExecutionResult> {
        const controller = new AbortController();
        let timedOut = false;
        const propagateAbort = () => controller.abort(request.context.signal.reason);
        request.context.signal.addEventListener("abort", propagateAbort, { once: true });

        const timeoutMs = request.context.timeoutMs
            ?? executor.resolveTimeoutMs?.(request.toolName, request.input, request.context)
            ?? this.defaultTimeoutMs;
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                controller.abort(new Error(`Tool execution timed out after ${timeoutMs}ms`));
            }, timeoutMs)
            : null;

        try {
            const output = await executor.execute(
                request.toolName,
                request.input,
                { ...request.context, signal: controller.signal },
            );
            if (request.context.signal.aborted) {
                return finishResult({ ...base, status: "cancelled", error: "Tool execution was cancelled" }, this.now);
            }
            if (timedOut) {
                return finishResult({ ...base, status: "timed_out", error: `Tool execution timed out after ${timeoutMs}ms` }, this.now);
            }
            return finishResult({ ...base, status: "completed", output }, this.now);
        } catch (error) {
            if (request.context.signal.aborted) {
                return finishResult({ ...base, status: "cancelled", error: "Tool execution was cancelled" }, this.now);
            }
            if (timedOut || controller.signal.aborted) {
                return finishResult({
                    ...base,
                    status: timedOut ? "timed_out" : "cancelled",
                    error: timedOut ? `Tool execution timed out after ${timeoutMs}ms` : "Tool execution was cancelled",
                }, this.now);
            }
            return finishResult({ ...base, status: "failed", error: errorMessage(error) }, this.now);
        } finally {
            if (timer) clearTimeout(timer);
            request.context.signal.removeEventListener("abort", propagateAbort);
        }
    }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("Approval was cancelled"));
    }

    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(signal.reason instanceof Error
                ? signal.reason
                : new Error("Approval was cancelled"));
        };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
    });
}

function redactToolExecutionResult(
    result: ToolExecutionResult,
): Omit<ToolExecutionResult, "output" | "error"> {
    return {
        toolName: result.toolName,
        source: result.source,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
    };
}

function redactToolExecutionContext(
    context: ToolExecutionContext,
): ToolRuntimeObservationContext {
    return {
        sessionId: context.sessionId,
        runId: context.runId,
        turnId: context.turnId,
        stepId: context.stepId,
        toolCallId: context.toolCallId,
        mode: context.mode,
    };
}
