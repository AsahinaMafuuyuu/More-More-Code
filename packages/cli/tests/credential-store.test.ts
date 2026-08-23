import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    CompositeCredentialStore,
    EncryptedFileCredentialStore,
    EnvironmentCredentialStore,
} from "../src/lib/credential-store";
import { defaultCredentialRef } from "../src/lib/provider-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
    ));
});

describe("CredentialStore", () => {
    test("round-trips encrypted credentials without plaintext serialization", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "more-more-code-credentials-"));
        temporaryDirectories.push(root);
        const home = path.join(root, "home");
        const store = new EncryptedFileCredentialStore({ globalHome: home });
        const ref = defaultCredentialRef("openai");
        const secret = "sk-test-TOP-SECRET-123";

        await store.set(ref, secret);
        expect(await store.get(ref)).toBe(secret);
        expect(await new EncryptedFileCredentialStore({ globalHome: home }).get(ref)).toBe(secret);

        const persisted = await readFile(path.join(home, ".more-more-code", "credentials.enc.json"), "utf-8");
        expect(persisted).not.toContain(secret);
        expect(persisted).not.toContain(ref);

        expect(await store.delete(ref)).toBe(true);
        expect(await store.get(ref)).toBeNull();
    });

    test("uses environment credentials only as a read-only fallback", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "more-more-code-credentials-env-"));
        temporaryDirectories.push(root);
        const primary = new EncryptedFileCredentialStore({ globalHome: path.join(root, "home") });
        const environment = new EnvironmentCredentialStore({ OPENAI_API_KEY: "ambient-key" });
        const store = new CompositeCredentialStore(primary, [environment]);
        const ref = defaultCredentialRef("openai");

        expect(await store.get(ref)).toBe("ambient-key");
        await store.set(ref, "local-key");
        expect(await store.get(ref)).toBe("local-key");
    });
});
