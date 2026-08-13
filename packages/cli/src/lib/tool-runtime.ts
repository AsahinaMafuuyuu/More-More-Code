import type { ModeType } from "@more-more-code/shared";
import type { RegisteredToolDefinition, ToolRegistry, ToolSourceKind } from "./tool-registry";

export type ToolPermissionEffect = "allow" | "deny" | "ask";
export type ToolPermissionDecision = { effect: ToolPermissionEffect; reason?: string };
export type ToolExecutionStatus = "completed" | "failed" | "cancelled" | "timed_out" | "denied" | "approval_required";

export type ToolExecutionContext = {
    sessionId: string;
    runId: string;
    turnId: string;
    stepId: string;
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

export type ToolPermissionRequest = {
    tool: RegisteredToolDefinition;
    input: unknown;
    context: ToolExecutionContext;
};

export type ToolPermissionPolicy = {
    evaluate(request: ToolPermissionRequest): ToolPermissionDecision | Promise<ToolPermissionDecision>;
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
    permissionPolicy?: ToolPermissionPolicy;
    defaultTimeoutMs?: number;
    now?: () => number;
};

const ALLOW_ALL_POLICY: ToolPermissionPolicy = {
    evaluate() {
        return { effect: "allow" };
    },
};

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
    private readonly permissionPolicy: ToolPermissionPolicy;
    private readonly defaultTimeoutMs: number;
    private readonly now: () => number;

    constructor(options: ToolRuntimeOptions) {
        this.registry = options.registry;
        this.executors = new Map(options.executors.map((executor) => [executor.source, executor]));
        this.permissionPolicy = options.permissionPolicy ?? ALLOW_ALL_POLICY;
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
        this.now = options.now ?? Date.now;
    }

    async run(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        const source = request.source ?? "native";
        const startedAt = this.now();
        const base = { toolName: request.toolName, source, startedAt } as const;

        if (request.context.signal.aborted) {
            return finishResult({ ...base, status: "cancelled", error: "Tool execution was cancelled" }, this.now);
        }

        const tool = this.registry.getToolDefinition(request.toolName, request.context.mode, source);
        if (!tool) {
            return finishResult({
                ...base,
                status: "denied",
                error: `Tool ${request.toolName} is not available in ${request.context.mode} mode`,
            }, this.now);
        }

        const permission = await this.permissionPolicy.evaluate({
            tool,
            input: request.input,
            context: request.context,
        });
        if (permission.effect === "deny") {
            return finishResult({
                ...base,
                status: "denied",
                error: permission.reason ?? `Permission denied for tool ${request.toolName}`,
            }, this.now);
        }
        if (permission.effect === "ask") {
            return finishResult({
                ...base,
                status: "approval_required",
                error: permission.reason ?? `Tool ${request.toolName} requires approval`,
            }, this.now);
        }

        // Permission evaluation may be async. Re-check before installing the
        // executor abort bridge so an interrupt cannot be lost in that gap.
        if (request.context.signal.aborted) {
            return finishResult({ ...base, status: "cancelled", error: "Tool execution was cancelled" }, this.now);
        }

        const executor = this.executors.get(source);
        if (!executor) {
            return finishResult({
                ...base,
                status: "failed",
                error: `No executor is registered for tool source ${source}`,
            }, this.now);
        }

        return this.executeWithLifecycle(request, executor, base);
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
