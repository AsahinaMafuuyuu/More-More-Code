import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bootstrapRuntimeStore,
  resolveRuntimeStoreDatabaseUrl,
} from "../src";

async function temporaryDirectory() {
  const testRoot = process.env.RUNTIME_STORE_TEST_ROOT;
  if (!testRoot) {
    throw new Error("Runtime Store integration tests must be run through the package test script");
  }
  return mkdtemp(path.join(testRoot, "more-more-code-bootstrap-"));
}

describe("Runtime Store bootstrap", () => {
  test("resolves the default database below the per-user MORE-MORE-CODE directory", async () => {
    const homeDirectory = await temporaryDirectory();
    const databaseUrl = resolveRuntimeStoreDatabaseUrl({ homeDirectory });

    expect(fileURLToPath(databaseUrl)).toBe(
      path.join(homeDirectory, ".more-more-code", "runtime", "runtime.db"),
    );
  });

  test("creates and repeatedly migrates a configured database without Prisma CLI", async () => {
    const directory = await temporaryDirectory();
    const databaseUrl = pathToFileURL(path.join(directory, "nested", "runtime.db")).href;

    const first = await bootstrapRuntimeStore({ databaseUrl });
    await first.store.append({
      sessionId: "session-one",
      type: "system",
      payload: {
        schemaVersion: 1,
        kind: "runtime.session_opened",
        recoveredEventOffset: 0,
        incompleteRunCount: 0,
        pendingExternalOperationCount: 0,
      },
    });
    await first.store.close();

    const second = await bootstrapRuntimeStore({ databaseUrl });
    expect(await second.store.listAfter("session-one", 0)).toHaveLength(1);
    await second.store.close();

    const client = createClient({ url: databaseUrl });
    try {
      const migrations = await client.execute(
        'SELECT "id" FROM "_MoreMoreCodeRuntimeMigration" ORDER BY "id"',
      );
      expect(migrations.rows.map((row) => row.id)).toEqual(["20260822000000_init"]);
    } finally {
      client.close();
    }
  });

  test("rejects non-file database URLs", () => {
    expect(() => resolveRuntimeStoreDatabaseUrl({
      databaseUrl: "https://example.com/runtime.db",
    })).toThrow("SQLite file: URL");
  });
});
