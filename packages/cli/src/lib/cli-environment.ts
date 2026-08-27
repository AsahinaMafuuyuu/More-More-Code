import { shutdownRuntimeEnvironment } from "./runtime-environment";
import { quiesceCliRuns } from "./run-lifecycle";
import { shutdownLocalSessionEnvironment } from "./session-environment";

export type CliEnvironmentShutdown = () => Promise<void>;

export function createCliEnvironmentShutdown(input: {
    quiesceRuns?: CliEnvironmentShutdown;
    shutdownLocalSessions: CliEnvironmentShutdown;
    shutdownRuntime: CliEnvironmentShutdown;
}): CliEnvironmentShutdown {
    let shutdownPromise: Promise<void> | null = null;

    return () => {
        if (shutdownPromise) return shutdownPromise;

        const attempt = (async () => {
            // Do not close either Store until all active Agent/Tool work has
            // been interrupted, reached a terminal runtime state, and flushed
            // its final semantic Session transition. Quiesce failures/timeouts
            // intentionally fail closed and leave both databases open.
            await input.quiesceRuns?.();
            let failure: unknown;
            try {
                await input.shutdownLocalSessions();
            } catch (error) {
                failure = error;
            }

            try {
                await input.shutdownRuntime();
            } catch (error) {
                failure ??= error;
            }

            if (failure) throw failure;
        })();
        shutdownPromise = attempt;
        void attempt.catch(() => {
            // A failed close should be visible and retryable; the run lifecycle
            // remains closed to new work, so a retry cannot race a new Tool.
            if (shutdownPromise === attempt) shutdownPromise = null;
        });
        return attempt;
    };
}

/** One idempotent shutdown path for Ctrl+C and the `/exit` command. */
export const shutdownCliEnvironment = createCliEnvironmentShutdown({
    quiesceRuns: quiesceCliRuns,
    shutdownLocalSessions: shutdownLocalSessionEnvironment,
    shutdownRuntime: shutdownRuntimeEnvironment,
});
