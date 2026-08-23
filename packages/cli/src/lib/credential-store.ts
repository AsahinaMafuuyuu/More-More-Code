import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
} from "crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import { defaultCredentialRef } from "./provider-registry";

export interface CredentialStore {
    get(credentialRef: string): Promise<string | null>;
    set(credentialRef: string, value: string): Promise<void>;
    delete(credentialRef: string): Promise<boolean>;
}

type CredentialMap = Record<string, string>;

const encryptedEnvelopeSchema = z.object({
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
}).strict();

type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;

const CREDENTIALS_FILE = "credentials.enc.json";
const CREDENTIALS_KEY_FILE = "credentials.key";

function resolveCredentialPaths(globalHome = homedir()) {
    const root = join(resolve(globalHome), ".more-more-code");
    return {
        root,
        dataPath: join(root, CREDENTIALS_FILE),
        keyPath: join(root, CREDENTIALS_KEY_FILE),
    };
}

async function readMissingAsNull(path: string) {
    try {
        return await readFile(path, "utf-8");
    } catch (error) {
        const code = error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : null;
        if (code === "ENOENT") return null;
        throw error;
    }
}

async function atomicPrivateWrite(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
    await rename(temporaryPath, path);
    try {
        await chmod(path, 0o600);
    } catch {
        // Windows ACL semantics differ from POSIX modes. Encryption remains the
        // confidentiality layer; platform-native secret stores can replace this adapter.
    }
}

export class EncryptedFileCredentialStore implements CredentialStore {
    private readonly dataPath: string;
    private readonly keyPath: string;

    constructor(options: { globalHome?: string } = {}) {
        const paths = resolveCredentialPaths(options.globalHome);
        this.dataPath = paths.dataPath;
        this.keyPath = paths.keyPath;
    }

    private async loadKey(createIfMissing: boolean) {
        const encoded = await readMissingAsNull(this.keyPath);
        if (encoded) {
            const key = Buffer.from(encoded.trim(), "base64");
            if (key.byteLength !== 32) throw new Error("Invalid local credential encryption key");
            return key;
        }
        if (!createIfMissing) return null;
        const key = randomBytes(32);
        await atomicPrivateWrite(this.keyPath, `${key.toString("base64")}\n`);
        return key;
    }

    private async readAll(): Promise<CredentialMap> {
        const raw = await readMissingAsNull(this.dataPath);
        if (!raw) return {};
        const envelope = encryptedEnvelopeSchema.parse(JSON.parse(raw));
        const key = await this.loadKey(false);
        if (!key) throw new Error("Credential data exists but encryption key is missing");
        const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(envelope.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, "base64")),
            decipher.final(),
        ]).toString("utf-8");
        const parsed = JSON.parse(plaintext) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Invalid decrypted credential payload");
        }
        for (const [keyName, value] of Object.entries(parsed)) {
            if (typeof value !== "string" || !keyName) {
                throw new Error("Invalid decrypted credential payload");
            }
        }
        return parsed as CredentialMap;
    }

    private async writeAll(credentials: CredentialMap) {
        const key = await this.loadKey(true);
        if (!key) throw new Error("Unable to initialize credential encryption key");
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(credentials), "utf-8"),
            cipher.final(),
        ]);
        const envelope: EncryptedEnvelope = {
            version: 1,
            algorithm: "aes-256-gcm",
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            ciphertext: ciphertext.toString("base64"),
        };
        await atomicPrivateWrite(this.dataPath, `${JSON.stringify(envelope)}\n`);
    }

    async get(credentialRef: string) {
        const credentials = await this.readAll();
        return credentials[credentialRef] ?? null;
    }

    async set(credentialRef: string, value: string) {
        if (!credentialRef.trim()) throw new Error("Credential reference is required");
        if (!value) throw new Error("Credential value is required");
        const credentials = await this.readAll();
        credentials[credentialRef] = value;
        await this.writeAll(credentials);
    }

    async delete(credentialRef: string) {
        const credentials = await this.readAll();
        if (!(credentialRef in credentials)) return false;
        delete credentials[credentialRef];
        await this.writeAll(credentials);
        return true;
    }
}

const DEFAULT_ENVIRONMENT_CREDENTIALS: Record<string, string> = {
    [defaultCredentialRef("openai")]: "OPENAI_API_KEY",
    [defaultCredentialRef("anthropic")]: "ANTHROPIC_API_KEY",
    [defaultCredentialRef("google")]: "GOOGLE_GENERATIVE_AI_API_KEY",
    [defaultCredentialRef("deepseek")]: "DEEPSEEK_API_KEY",
};

export class EnvironmentCredentialStore implements CredentialStore {
    constructor(
        private readonly environment: NodeJS.ProcessEnv = process.env,
        private readonly refs = DEFAULT_ENVIRONMENT_CREDENTIALS,
    ) {}

    async get(credentialRef: string) {
        const environmentName = this.refs[credentialRef];
        return environmentName ? this.environment[environmentName] ?? null : null;
    }

    async set(): Promise<void> {
        throw new Error("EnvironmentCredentialStore is read-only");
    }

    async delete(): Promise<boolean> {
        throw new Error("EnvironmentCredentialStore is read-only");
    }
}

export class CompositeCredentialStore implements CredentialStore {
    constructor(
        private readonly writable: CredentialStore,
        private readonly fallbacks: CredentialStore[] = [],
    ) {}

    async get(credentialRef: string) {
        const primary = await this.writable.get(credentialRef);
        if (primary != null) return primary;
        for (const store of this.fallbacks) {
            const value = await store.get(credentialRef);
            if (value != null) return value;
        }
        return null;
    }

    set(credentialRef: string, value: string) {
        return this.writable.set(credentialRef, value);
    }

    delete(credentialRef: string) {
        return this.writable.delete(credentialRef);
    }
}

export function createCredentialStore(options: { globalHome?: string } = {}): CredentialStore {
    return new CompositeCredentialStore(
        new EncryptedFileCredentialStore(options),
        [new EnvironmentCredentialStore()],
    );
}
