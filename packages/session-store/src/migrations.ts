export type LocalSessionStoreMigration = {
  id: string;
  statements: readonly string[];
};

/**
 * Migrations are embedded so an installed CLI can initialize or upgrade its
 * local authority without a repository checkout or an external migration CLI.
 */
export const LOCAL_SESSION_STORE_MIGRATIONS: readonly LocalSessionStoreMigration[] = [
  {
    id: "20260826000000_local_session_authority_v1",
    statements: [
      `
CREATE TABLE IF NOT EXISTS "LocalSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL,
  "rootEntryId" TEXT NOT NULL,
  "activeEntryId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "archivedAt" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 0
)
`,
      `

CREATE TABLE IF NOT EXISTS "LocalSessionEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "parentId" TEXT,
  "type" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "entryJson" TEXT NOT NULL,
  FOREIGN KEY ("sessionId") REFERENCES "LocalSession"("id") ON DELETE RESTRICT
)
`,
      `

CREATE UNIQUE INDEX IF NOT EXISTS "LocalSessionEntry_sessionId_sequence_key"
  ON "LocalSessionEntry"("sessionId", "sequence")
`,
      `
CREATE INDEX IF NOT EXISTS "LocalSession_updatedAt_idx"
  ON "LocalSession"("updatedAt" DESC, "createdAt" DESC, "id" ASC)
`,
      `
CREATE INDEX IF NOT EXISTS "LocalSessionEntry_sessionId_sequence_idx"
  ON "LocalSessionEntry"("sessionId", "sequence" ASC)
`,
    ],
  },
];
