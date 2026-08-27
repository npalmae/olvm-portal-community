CREATE TABLE "BackupStorageConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 's3',
    "endpoint" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'backups/bastion',
    "accessKey" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "forcePathStyle" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "scheduleHour" INTEGER NOT NULL DEFAULT 2,
    "scheduleWeekday" INTEGER NOT NULL DEFAULT 0,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "retentionCount" INTEGER NOT NULL DEFAULT 30,
    "defaultProfile" TEXT NOT NULL DEFAULT 'operational',
    "lastScheduledAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupStorageConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" TEXT NOT NULL,
    "objectKey" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupJob_createdAt_idx" ON "BackupJob"("createdAt");
CREATE INDEX "BackupJob_status_idx" ON "BackupJob"("status");
