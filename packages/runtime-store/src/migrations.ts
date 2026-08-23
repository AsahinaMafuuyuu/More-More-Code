export type RuntimeStoreMigration = {
  id: string;
  sql: string;
};

/**
 * Runtime migrations are embedded so an installed CLI never needs Prisma CLI
 * or repository-relative migration files at startup.
 */
export const RUNTIME_STORE_MIGRATIONS: readonly RuntimeStoreMigration[] = [
  {
    id: "20260822000000_init",
    sql: `
CREATE TABLE IF NOT EXISTS "RuntimeEvent" (
    "offset" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RuntimeSnapshot" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventOffset" INTEGER NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "RuntimeEvent_id_key" ON "RuntimeEvent"("id");
CREATE INDEX IF NOT EXISTS "RuntimeEvent_sessionId_offset_idx" ON "RuntimeEvent"("sessionId", "offset");
CREATE UNIQUE INDEX IF NOT EXISTS "RuntimeSnapshot_id_key" ON "RuntimeSnapshot"("id");
CREATE INDEX IF NOT EXISTS "RuntimeSnapshot_sessionId_eventOffset_idx" ON "RuntimeSnapshot"("sessionId", "eventOffset");
CREATE INDEX IF NOT EXISTS "RuntimeSnapshot_sessionId_sequence_idx" ON "RuntimeSnapshot"("sessionId", "sequence");
`,
  },
];
