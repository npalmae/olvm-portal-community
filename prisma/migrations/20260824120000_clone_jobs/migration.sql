-- CreateTable
CREATE TABLE "CloneJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceVmId" TEXT NOT NULL,
    "sourceVmName" TEXT,
    "cloneName" TEXT NOT NULL,
    "clonedVmId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloneJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CloneJob_tenantId_createdAt_idx" ON "CloneJob"("tenantId", "createdAt");
CREATE INDEX "CloneJob_tenantId_status_idx" ON "CloneJob"("tenantId", "status");
ALTER TABLE "CloneJob" ADD CONSTRAINT "CloneJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
