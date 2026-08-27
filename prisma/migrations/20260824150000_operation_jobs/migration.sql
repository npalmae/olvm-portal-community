CREATE TABLE "OperationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetVmId" TEXT,
    "targetVmName" TEXT,
    "requestedBy" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "resultVmId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperationJob_tenantId_createdAt_idx" ON "OperationJob"("tenantId", "createdAt");
CREATE INDEX "OperationJob_tenantId_status_idx" ON "OperationJob"("tenantId", "status");
ALTER TABLE "OperationJob" ADD CONSTRAINT "OperationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
