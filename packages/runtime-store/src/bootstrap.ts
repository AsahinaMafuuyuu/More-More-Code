import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RuntimeJsonValue } from "@more-more-code/harness";
import { RUNTIME_STORE_MIGRATIONS } from "./migrations";
import { SqliteRuntimeStore } from "./sqlite-runtime-store";

export const RUNTIME_STORE_DATABASE_ENV = "RUNTIME_STORE_DATABASE_URL";
export const RUNTIME_STORE_RELATIVE_PATH = path.join(
  ".more-more-code",
  "runtime",
  "runtime.db",
);

export type RuntimeStoreBootstrapOptions = {
  databaseUrl?: string;
  homeDirectory?: string;
};

export type BootstrappedRuntimeStore<TState extends RuntimeJsonValue = RuntimeJsonValue> = {
  databaseUrl: string;
  store: SqliteRuntimeStore<TState>;
};

export function resolveRuntimeStoreDatabaseUrl(
  options: RuntimeStoreBootstrapOptions = {},
): string {
  const configured = options.databaseUrl ?? process.env[RUNTIME_STORE_DATABASE_ENV];
  if (configured) {
    return normalizeAbsoluteFileUrl(configured);
  }

  return pathToFileURL(
    path.join(options.homeDirectory ?? homedir(), RUNTIME_STORE_RELATIVE_PATH),
  ).href;
}

export async function bootstrapRuntimeStore<TState extends RuntimeJsonValue = RuntimeJsonValue>(
  options: RuntimeStoreBootstrapOptions = {},
): Promise<BootstrappedRuntimeStore<TState>> {
  const databaseUrl = resolveRuntimeStoreDatabaseUrl(options);
  await mkdir(path.dirname(fileURLToPath(databaseUrl)), { recursive: true });
  await migrateRuntimeStore(databaseUrl);

  return {
    databaseUrl,
    store: new SqliteRuntimeStore<TState>({ databaseUrl }),
  };
}

export async function migrateRuntimeStore(databaseUrl: string): Promise<void> {
  const normalizedUrl = normalizeAbsoluteFileUrl(databaseUrl);
  const client = createClient({ url: normalizedUrl });

  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "_MoreMoreCodeRuntimeMigration" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const transaction = await client.transaction("write");
    try {
      const appliedRows = await transaction.execute(
        'SELECT "id" FROM "_MoreMoreCodeRuntimeMigration"',
      );
      const appliedIds = new Set(appliedRows.rows.map((row) => String(row.id)));

      for (const migration of RUNTIME_STORE_MIGRATIONS) {
        if (appliedIds.has(migration.id)) continue;
        await transaction.executeMultiple(migration.sql);
        await transaction.execute({
          sql: 'INSERT INTO "_MoreMoreCodeRuntimeMigration" ("id") VALUES (?)',
          args: [migration.id],
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  } finally {
    client.close();
  }
}

function normalizeAbsoluteFileUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new TypeError("Runtime Store databaseUrl must be an absolute SQLite file URL");
  }

  if (parsed.protocol !== "file:") {
    throw new TypeError("Runtime Store databaseUrl must be a SQLite file: URL");
  }

  const databasePath = fileURLToPath(parsed);
  if (!path.isAbsolute(databasePath)) {
    throw new TypeError("Runtime Store databaseUrl must resolve to an absolute path");
  }

  return pathToFileURL(databasePath).href;
}
