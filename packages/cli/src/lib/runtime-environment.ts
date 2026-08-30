import {
    ProjectionCache,
    RuntimeSession,
    type RuntimeJsonValue,
    type RuntimeSessionProjection,
} from "@more-more-code/harness";
import {
    bootstrapRuntimeStore,
    type BootstrappedRuntimeStore,
    type RuntimeStoreBootstrapOptions,
} from "@more-more-code/runtime-store";

type RuntimeEnvironment = {
    databaseUrl: string;
    store: BootstrappedRuntimeStore<RuntimeSessionProjection & RuntimeJsonValue>["store"];
    projectionCache: ProjectionCache<RuntimeSessionProjection>;
    sessions: Map<string, RuntimeSession>;
};

let runtimeEnvironment: RuntimeEnvironment | null = null;
let runtimeEnvironmentPromise: Promise<RuntimeEnvironment> | null = null;
let runtimeEnvironmentShutdownPromise: Promise<void> | null = null;

export async function bootstrapRuntimeEnvironment(
    options: RuntimeStoreBootstrapOptions = {},
): Promise<RuntimeEnvironment> {
    if (runtimeEnvironmentShutdownPromise) await runtimeEnvironmentShutdownPromise;
    if (runtimeEnvironment) return runtimeEnvironment;
    runtimeEnvironmentPromise ??= bootstrapRuntimeStore<RuntimeSessionProjection & RuntimeJsonValue>(
        options,
    ).then((bootstrapped) => {
        runtimeEnvironment = {
            databaseUrl: bootstrapped.databaseUrl,
            store: bootstrapped.store,
            projectionCache: new ProjectionCache<RuntimeSessionProjection>(),
            sessions: new Map(),
        };
        return runtimeEnvironment;
    }).catch((error) => {
        runtimeEnvironmentPromise = null;
        throw error;
    });
    return runtimeEnvironmentPromise;
}

export function getRuntimeSession(sessionId: string): RuntimeSession {
    if (!runtimeEnvironment) {
        throw new Error("Runtime environment has not been bootstrapped");
    }

    let session = runtimeEnvironment.sessions.get(sessionId);
    if (!session) {
        session = new RuntimeSession({
            sessionId,
            store: runtimeEnvironment.store,
            projectionCache: runtimeEnvironment.projectionCache,
        });
        runtimeEnvironment.sessions.set(sessionId, session);
    }
    return session;
}

export async function shutdownRuntimeEnvironment(): Promise<void> {
    if (runtimeEnvironmentShutdownPromise) return runtimeEnvironmentShutdownPromise;

    const environment = runtimeEnvironment;
    const pendingEnvironment = runtimeEnvironmentPromise;
    runtimeEnvironment = null;
    runtimeEnvironmentPromise = null;
    runtimeEnvironmentShutdownPromise = (async () => {
        const resolvedEnvironment = environment ?? await pendingEnvironment;
        if (!resolvedEnvironment) return;
        resolvedEnvironment.sessions.clear();
        resolvedEnvironment.projectionCache.clear();
        await resolvedEnvironment.store.close();
    })().finally(() => {
        runtimeEnvironmentShutdownPromise = null;
    });
    return runtimeEnvironmentShutdownPromise;
}
