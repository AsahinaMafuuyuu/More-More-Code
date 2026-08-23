import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import {
    BUILT_IN_PROVIDER_KINDS,
    SUPPORTED_CHAT_MODELS,
    type BuiltInProviderKind,
    type ModelRef,
    type ProviderId,
    type ProviderKind,
} from "@more-more-code/shared";

export const PROVIDER_REGISTRY_VERSION = 1 as const;
export const PROVIDER_REGISTRY_FILE = "providers.json";

const providerIdSchema = z.string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "Provider IDs must use lowercase letters, digits, '.', '_' or '-'");

const credentialRefSchema = z.string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/, "Invalid credential reference");

const modelIdSchema = z.string().trim().min(1).max(256);

const apiKeyAuthSchema = z.object({
    type: z.literal("api-key"),
    credentialRef: credentialRefSchema,
}).strict();

const bearerAuthSchema = z.object({
    type: z.literal("bearer"),
    credentialRef: credentialRefSchema,
}).strict();

const noAuthSchema = z.object({
    type: z.literal("none"),
}).strict();

const codexOAuthAuthSchema = z.object({
    type: z.literal("codex-oauth"),
}).strict();

export const providerAuthSchema = z.discriminatedUnion("type", [
    apiKeyAuthSchema,
    bearerAuthSchema,
    noAuthSchema,
    codexOAuthAuthSchema,
]);

export type ProviderAuthConfig = z.infer<typeof providerAuthSchema>;

const baseProviderSchema = z.object({
    id: providerIdSchema,
    displayName: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    models: z.array(modelIdSchema).default([]),
});

const openAIProviderSchema = baseProviderSchema.extend({
    kind: z.literal("openai"),
    auth: z.union([apiKeyAuthSchema, codexOAuthAuthSchema]),
}).strict();

const anthropicProviderSchema = baseProviderSchema.extend({
    kind: z.literal("anthropic"),
    auth: apiKeyAuthSchema,
}).strict();

const googleProviderSchema = baseProviderSchema.extend({
    kind: z.literal("google"),
    auth: apiKeyAuthSchema,
}).strict();

const deepSeekProviderSchema = baseProviderSchema.extend({
    kind: z.literal("deepseek"),
    auth: apiKeyAuthSchema,
}).strict();

const httpUrlSchema = z.string().url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        ctx.addIssue({ code: "custom", message: "Provider baseURL must use http or https" });
    }
    if (url.username || url.password) {
        ctx.addIssue({ code: "custom", message: "Provider baseURL must not contain credentials" });
    }
});

const customProviderSchema = baseProviderSchema.extend({
    kind: z.literal("custom"),
    protocol: z.literal("openai-compatible"),
    baseURL: httpUrlSchema,
    auth: z.union([apiKeyAuthSchema, bearerAuthSchema, noAuthSchema]),
}).strict();

export const providerConfigSchema = z.discriminatedUnion("kind", [
    openAIProviderSchema,
    anthropicProviderSchema,
    googleProviderSchema,
    deepSeekProviderSchema,
    customProviderSchema,
]).superRefine((provider, ctx) => {
    if (provider.kind !== "custom" && provider.id !== provider.kind) {
        ctx.addIssue({
            code: "custom",
            path: ["id"],
            message: `Built-in provider '${provider.kind}' must use provider ID '${provider.kind}'`,
        });
    }
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type CustomProviderConfig = Extract<ProviderConfig, { kind: "custom" }>;

const registryFileSchema = z.object({
    version: z.literal(PROVIDER_REGISTRY_VERSION),
    providers: z.array(providerConfigSchema),
}).strict().superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < file.providers.length; index += 1) {
        const provider = file.providers[index]!;
        if (seen.has(provider.id)) {
            ctx.addIssue({
                code: "custom",
                path: ["providers", index, "id"],
                message: `Duplicate provider ID '${provider.id}'`,
            });
        }
        seen.add(provider.id);
    }
});

export type ProviderRegistryFile = z.infer<typeof registryFileSchema>;

const BUILT_IN_DISPLAY_NAMES: Record<BuiltInProviderKind, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini",
    deepseek: "DeepSeek",
};

function recommendedModels(provider: BuiltInProviderKind) {
    return SUPPORTED_CHAT_MODELS
        .filter((model) => model.provider === provider)
        .map((model) => model.id);
}

export function defaultCredentialRef(providerId: ProviderId) {
    return `provider:${providerId}:api-key`;
}

export function createDefaultProviderRegistryFile(): ProviderRegistryFile {
    return {
        version: PROVIDER_REGISTRY_VERSION,
        providers: BUILT_IN_PROVIDER_KINDS.map((kind) => ({
            id: kind,
            kind,
            displayName: BUILT_IN_DISPLAY_NAMES[kind],
            enabled: true,
            models: recommendedModels(kind),
            auth: {
                type: "api-key" as const,
                credentialRef: defaultCredentialRef(kind),
            },
        })) as ProviderConfig[],
    };
}

export function resolveProviderRegistryPath(globalHome = homedir()) {
    return join(resolve(globalHome), ".more-more-code", PROVIDER_REGISTRY_FILE);
}

function serializeRegistry(file: ProviderRegistryFile) {
    return `${JSON.stringify(file, null, 2)}\n`;
}

async function atomicWrite(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
    await rename(temporaryPath, path);
}

function validateRegistry(input: unknown, path: string): ProviderRegistryFile {
    const parsed = registryFileSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error(`Invalid provider registry at ${path}: ${parsed.error.message}`);
    }

    const builtIns = new Set(parsed.data.providers
        .filter((provider) => provider.kind !== "custom")
        .map((provider) => provider.kind));
    for (const kind of BUILT_IN_PROVIDER_KINDS) {
        if (!builtIns.has(kind)) {
            throw new Error(`Invalid provider registry at ${path}: missing built-in provider '${kind}'`);
        }
    }
    return parsed.data;
}

export class ProviderRegistry {
    private constructor(
        readonly path: string,
        private file: ProviderRegistryFile,
    ) {}

    static async load(options: {
        globalHome?: string;
        ensureLayout?: boolean;
    } = {}) {
        const path = resolveProviderRegistryPath(options.globalHome);
        let raw: string;
        try {
            raw = await readFile(path, "utf-8");
        } catch (error) {
            const code = error instanceof Error && "code" in error
                ? String((error as NodeJS.ErrnoException).code)
                : null;
            if (code !== "ENOENT") throw error;
            const initial = createDefaultProviderRegistryFile();
            if (options.ensureLayout !== false) {
                await atomicWrite(path, serializeRegistry(initial));
            }
            return new ProviderRegistry(path, initial);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(`Invalid JSON in provider registry: ${path}`, { cause: error });
        }
        return new ProviderRegistry(path, validateRegistry(parsed, path));
    }

    list() {
        return structuredClone(this.file.providers);
    }

    get(providerId: ProviderId) {
        const provider = this.file.providers.find((candidate) => candidate.id === providerId);
        return provider ? structuredClone(provider) : null;
    }

    listModelRefs(): ModelRef[] {
        return this.file.providers.flatMap((provider) => provider.enabled
            ? provider.models.map((modelId) => ({ providerId: provider.id, modelId }))
            : []);
    }

    async saveProvider(input: ProviderConfig) {
        const provider = providerConfigSchema.parse(input);
        const candidate = structuredClone(this.file);
        const existingIndex = candidate.providers.findIndex((item) => item.id === provider.id);

        if (existingIndex >= 0) {
            const existing = candidate.providers[existingIndex]!;
            if (existing.kind !== provider.kind) {
                throw new Error(`Provider '${provider.id}' kind cannot change from '${existing.kind}' to '${provider.kind}'`);
            }
            candidate.providers[existingIndex] = provider;
        } else {
            if (provider.kind !== "custom") {
                throw new Error(`Built-in provider '${provider.kind}' cannot be added dynamically`);
            }
            candidate.providers.push(provider);
        }

        const validated = validateRegistry(candidate, this.path);
        await atomicWrite(this.path, serializeRegistry(validated));
        this.file = validated;
        return structuredClone(provider);
    }

    async removeCustomProvider(providerId: ProviderId) {
        const provider = this.file.providers.find((candidate) => candidate.id === providerId);
        if (!provider) return false;
        if (provider.kind !== "custom") {
            throw new Error(`Built-in provider '${providerId}' cannot be removed`);
        }
        const candidate: ProviderRegistryFile = {
            ...structuredClone(this.file),
            providers: this.file.providers.filter((item) => item.id !== providerId),
        };
        const validated = validateRegistry(candidate, this.path);
        await atomicWrite(this.path, serializeRegistry(validated));
        this.file = validated;
        return true;
    }
}

export function isBuiltInProviderKind(kind: ProviderKind): kind is BuiltInProviderKind {
    return (BUILT_IN_PROVIDER_KINDS as readonly string[]).includes(kind);
}
