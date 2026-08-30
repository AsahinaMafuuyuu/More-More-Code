export type CliRunQuiescenceHandle = {
    /** Abort any active model, approval, or Tool work for this local Run. */
    interrupt: () => void | boolean | Promise<void | boolean>;
    /** Resolves only once the AgentLoop has durably reached a terminal Run state. */
    waitForIdle: () => Promise<void>;
    /**
     * Resolves post-loop semantic persistence such as final Session Tree
     * message syncs. This is separate from AgentLoop's runtime-event tail.
     */
    waitForPersistence?: () => Promise<void>;
};

export type CliRunLifecycleOptions = {
    /** Set to 0 in embedding/tests to wait indefinitely. */
    quiesceTimeoutMs?: number;
};

export class CliShutdownInProgressError extends Error {
    constructor() {
        super("CLI shutdown is in progress; new model or Tool work is blocked");
        this.name = "CliShutdownInProgressError";
    }
}

export class CliRunQuiescenceTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`CLI shutdown timed out after ${timeoutMs}ms while waiting for active Run/Tool work to become durable; stores remain open`);
        this.name = "CliRunQuiescenceTimeoutError";
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new CliRunQuiescenceTimeoutError(timeoutMs));
        }, timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * Process-local execution lifecycle coordination. It intentionally stores
 * only generic interrupt/idle/persistence callbacks, not React/UI state, so
 * shutdown can safely quiesce every active local Run before closing SQLite.
 */
export class CliRunLifecycle {
    private readonly handles = new Set<CliRunQuiescenceHandle>();
    private readonly quiesceTimeoutMs: number;
    private acceptingWork = true;
    private quiescePromise: Promise<void> | null = null;

    constructor(options: CliRunLifecycleOptions = {}) {
        this.quiesceTimeoutMs = options.quiesceTimeoutMs ?? 30_000;
    }

    get isAcceptingWork() {
        return this.acceptingWork;
    }

    assertCanStartWork() {
        if (!this.acceptingWork) throw new CliShutdownInProgressError();
    }

    register(handle: CliRunQuiescenceHandle) {
        this.handles.add(handle);
        // A handle mounted after shutdown started cannot legitimately begin
        // new work; interrupt it defensively while the active quiesce pass
        // observes it on its next snapshot.
        if (!this.acceptingWork) {
            void Promise.resolve(handle.interrupt()).catch(() => undefined);
        }
        return () => {
            this.handles.delete(handle);
        };
    }

    quiesce(): Promise<void> {
        if (this.quiescePromise) return this.quiescePromise;

        this.acceptingWork = false;
        const attempt = withTimeout(this.quiesceAll(), this.quiesceTimeoutMs);
        this.quiescePromise = attempt;
        void attempt.catch(() => {
            // Keep the work gate closed, but allow an explicit retry after a
            // transient timeout/failure. A retry still cannot admit new work.
            if (this.quiescePromise === attempt) this.quiescePromise = null;
        });
        return attempt;
    }

    private async quiesceAll() {
        // Repeat if a registered handle changes while the previous snapshot is
        // settling. Once the gate is closed no correctly-integrated caller can
        // start new work, so this loop converges without closing over a UI
        // singleton.
        while (true) {
            const snapshot = [...this.handles];
            await Promise.all(snapshot.map(async (handle) => {
                await handle.interrupt();
                await handle.waitForIdle();
                await handle.waitForPersistence?.();
            }));

            if ([...this.handles].every((handle) => snapshot.includes(handle))) {
                return;
            }
        }
    }
}

const cliRunLifecycle = new CliRunLifecycle();

export function getCliRunLifecycle() {
    return cliRunLifecycle;
}

export function quiesceCliRuns() {
    return cliRunLifecycle.quiesce();
}
