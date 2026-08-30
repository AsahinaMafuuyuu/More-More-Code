import { defineConfig } from "prisma/config";
import path from "node:path";
import { pathToFileURL } from "node:url";

// This is anchored to this package rather than the invoking process's cwd.
// Applications should set RUNTIME_STORE_DATABASE_URL explicitly; tests do so
// with a temporary database file.
const packagedDatabaseUrl = pathToFileURL(
  path.join(import.meta.dirname, "prisma", "runtime-store.db"),
).href;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.RUNTIME_STORE_DATABASE_URL ?? packagedDatabaseUrl,
  },
});
