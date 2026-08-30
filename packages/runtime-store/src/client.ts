import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client.ts";

export function createRuntimeStoreClient(databaseUrl: string): PrismaClient {
  assertSqliteDatabaseUrl(databaseUrl);

  return new PrismaClient({
    adapter: new PrismaLibSql({ url: normalizeAdapterDatabaseUrl(databaseUrl) }),
  });
}

function assertSqliteDatabaseUrl(databaseUrl: string): void {
  if (!databaseUrl.startsWith("file:")) {
    throw new TypeError("Runtime Store databaseUrl must be a SQLite file: URL");
  }
}

function normalizeAdapterDatabaseUrl(databaseUrl: string): string {
  // Keep standard RFC file URLs intact. In particular, `file:///C:/…` is the
  // portable Windows form accepted by libSQL, unlike the historical
  // better-sqlite3 adapter's path-only handling.
  if (databaseUrl.startsWith("file://")) {
    return new URL(databaseUrl).href;
  }

  return databaseUrl;
}
