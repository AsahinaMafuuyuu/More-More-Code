import {
    bootstrapLocalSessionStore,
    type BootstrappedLocalSessionStore,
    type LocalSessionStoreBootstrapOptions,
} from "@more-more-code/session-store";
import {
    createLocalSessionAuthority,
    type LocalSessionAuthority,
} from "./local-session-authority";

export type LocalSessionEnvironment = {
    databaseUrl: string;
    store: BootstrappedLocalSessionStore["store"];
    authority: LocalSessionAuthority;
};

let localSessionEnvironment: LocalSessionEnvironment | null = null;
let localSessionEnvironmentPromise: Promise<LocalSessionEnvironment> | null = null;
let localSessionEnvironmentShutdownPromise: Promise<void> | null = null;

/**
 * Boots exactly one local semantic Session Store for the installed CLI
 * lifetime. Tests may inject a file URL through the Store bootstrap options.
 */
export async function bootstrapLocalSessionEnvironment(
    options: LocalSessionStoreBootstrapOptions = {},
): Promise<LocalSessionEnvironment> {
    if (localSessionEnvironmentShutdownPromise) {
        await localSessionEnvironmentShutdownPromise;
    }
    if (localSessionEnvironment) return localSessionEnvironment;

    localSessionEnvironmentPromise ??= bootstrapLocalSessionStore(options)
        .then((bootstrapped) => {
            localSessionEnvironment = {
                databaseUrl: bootstrapped.databaseUrl,
                store: bootstrapped.store,
                authority: createLocalSessionAuthority({ store: bootstrapped.store }),
            };
            return localSessionEnvironment;
        })
        .catch((error) => {
            localSessionEnvironmentPromise = null;
            throw error;
        });
    return localSessionEnvironmentPromise;
}

export function getLocalSessionEnvironment(): LocalSessionEnvironment {
    if (!localSessionEnvironment) {
        throw new Error("Local Session environment has not been bootstrapped");
    }
    return localSessionEnvironment;
}

export function getLocalSessionAuthority(): LocalSessionAuthority {
    return getLocalSessionEnvironment().authority;
}

/** Idempotently closes the one CLI-owned local semantic Session Store. */
export async function shutdownLocalSessionEnvironment(): Promise<void> {
    if (localSessionEnvironmentShutdownPromise) {
        return localSessionEnvironmentShutdownPromise;
    }

    const environment = localSessionEnvironment;
    const pendingEnvironment = localSessionEnvironmentPromise;
    localSessionEnvironment = null;
    localSessionEnvironmentPromise = null;
    localSessionEnvironmentShutdownPromise = (async () => {
        const resolvedEnvironment = environment ?? await pendingEnvironment;
        if (!resolvedEnvironment) return;
        try {
            await resolvedEnvironment.store.close();
        } finally {
            // A bootstrap that was still resolving when shutdown began sets
            // this singleton after we cleared it above. Do not let a closed
            // Store become the next process-wide authority.
            if (localSessionEnvironment === resolvedEnvironment) {
                localSessionEnvironment = null;
            }
        }
    })().finally(() => {
        localSessionEnvironmentShutdownPromise = null;
    });
    return localSessionEnvironmentShutdownPromise;
}
