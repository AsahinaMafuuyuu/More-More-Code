-- CreateTable
CREATE TABLE IF NOT EXISTS "RuntimeEvent" (
    "offset" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RuntimeSnapshot" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventOffset" INTEGER NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RuntimeEvent_id_key" ON "RuntimeEvent"("id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RuntimeEvent_sessionId_offset_idx" ON "RuntimeEvent"("sessionId", "offset");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RuntimeSnapshot_id_key" ON "RuntimeSnapshot"("id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RuntimeSnapshot_sessionId_eventOffset_idx" ON "RuntimeSnapshot"("sessionId", "eventOffset");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RuntimeSnapshot_sessionId_sequence_idx" ON "RuntimeSnapshot"("sessionId", "sequence");
