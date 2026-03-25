CREATE TABLE "WorkingMemorySnapshot" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" JSONB NOT NULL,
    "view" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingMemorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkingMemorySnapshot_scopeId_key" ON "WorkingMemorySnapshot"("scopeId");
CREATE INDEX "WorkingMemorySnapshot_scopeId_updatedAt_idx" ON "WorkingMemorySnapshot"("scopeId", "updatedAt");

ALTER TABLE "WorkingMemorySnapshot"
ADD CONSTRAINT "WorkingMemorySnapshot_scopeId_fkey"
FOREIGN KEY ("scopeId") REFERENCES "ProjectScope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
