import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCAL_SESSION_STORE_MIGRATIONS } from "./migrations";
import { SqliteLocalSessionStore } from "./sqlite-local-session-store";
import type {
  BootstrappedLocalSessionStore,
  LocalSessionStoreBootstrapOptions,
  LocalSessionStoreOptions,
} from "./types";

export const LOCAL_SESSION_STORE_DATABASE_ENV = "LOCAL_SESSION_STORE_DATABASE_URL";
export const LOCAL_SESSION_STORE_RELATIVE_PATH = path.join(
  ".more-more-code",
  "sessions",
  "sessions.db",
);

export function resolveLocalSessionStoreDatabaseUrl(
  options: LocalSessionStoreBootstrapOptions = {},
): string {
  const configured = options.databaseUrl ?? process.env[LOCAL_SESSION_STORE_DATABASE_ENV];
  if (configured) return normalizeLocalSessionStoreDatabaseUrl(configured);

  return pathToFileURL(
    path.join(options.homeDirectory ?? homedir(), LOCAL_SESSION_STORE_RELATIVE_PATH),
  ).href;
}

export async function bootstrapLocalSessionStore(
  options: LocalSessionStoreBootstrapOptions = {},
): Promise<BootstrappedLocalSessionStore> {
  const databaseUrl = resolveLocalSessionStoreDatabaseUrl(options);
  await mkdir(path.dirname(fileURLToPath(databaseUrl)), { recursive: true });
  await migrateLocalSessionStore(databaseUrl);

  return {
    databaseUrl,
    store: new SqliteLocalSessionStore({ databaseUrl, now: options.now }),
  };
}

/**
 * Explicit factory for embedding applications that already own their database
 * path. It still performs the same local bootstrap/migrations as the default.
 */
export async function createSqliteLocalSessionStore(
  options: LocalSessionStoreOptions,
): Promise<SqliteLocalSessionStore> {
  const databaseUrl = normalizeLocalSessionStoreDatabaseUrl(options.databaseUrl);
  await mkdir(path.dirname(fileURLToPath(databaseUrl)), { recursive: true });
  await migrateLocalSessionStore(databaseUrl);
  return new SqliteLocalSessionStore({ databaseUrl, now: options.now });
}

export async function migrateLocalSessionStore(databaseUrl: string): Promise<void> {
  const normalizedUrl = normalizeLocalSessionStoreDatabaseUrl(databaseUrl);
  await mkdir(path.dirname(fileURLToPath(normalizedUrl)), { recursive: true });
  const client = createClient({ url: normalizedUrl });

  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "_MoreMoreCodeSessionMigration" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" INTEGER NOT NULL
      )
    `);

    let transactionOpen = false;
    try {
      await client.execute("BEGIN IMMEDIATE");
      transactionOpen = true;
      const applied = await client.execute(
        'SELECT "id" FROM "_MoreMoreCodeSessionMigration"',
      );
      const appliedIds = new Set(applied.rows.map((row) => String(row.id)));

      for (const migration of LOCAL_SESSION_STORE_MIGRATIONS) {
        if (appliedIds.has(migration.id)) continue;
        for (const statement of migration.statements) {
          await client.execute(statement);
        }
        await client.execute({
          sql: 'INSERT INTO "_MoreMoreCodeSessionMigration" ("id", "appliedAt") VALUES (?, ?)',
          args: [migration.id, Date.now()],
        });
      }

      await client.execute("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.execute("ROLLBACK");
        } catch {
          // Preserve the original migration error.
        }
      }
      throw error;
    }
  } finally {
    client.close();
  }
}

export function normalizeLocalSessionStoreDatabaseUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new TypeError("Local Session Store databaseUrl must be an absolute SQLite file URL");
  }

  if (parsed.protocol !== "file:") {
    throw new TypeError("Local Session Store databaseUrl must be a SQLite file: URL");
  }

  const databasePath = fileURLToPath(parsed);
  if (!path.isAbsolute(databasePath)) {
    throw new TypeError("Local Session Store databaseUrl must resolve to an absolute path");
  }

  return pathToFileURL(databasePath).href;
}
