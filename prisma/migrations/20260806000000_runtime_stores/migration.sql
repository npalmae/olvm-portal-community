CREATE TABLE IF NOT EXISTS "Engine" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "baseUrl" TEXT NOT NULL,
  "username" TEXT, "password" TEXT, "token" TEXT, "allowInsecure" BOOLEAN NOT NULL DEFAULT false,
  "caCert" TEXT, "sharedStorageDomains" TEXT[] NOT NULL, "brandName" TEXT,
  "brandLogoUrl" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "engineId" TEXT NOT NULL,
  "tag" TEXT, "storageDomains" TEXT[] NOT NULL, "networks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "networkConfig" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "Engine"("id") ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "password" TEXT NOT NULL, "name" TEXT NOT NULL,
  "globalRole" TEXT, "defaultTenantId" TEXT, "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'user',
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");
CREATE TABLE IF NOT EXISTS "EmailConfig" (
  "id" INTEGER NOT NULL PRIMARY KEY, "provider" TEXT NOT NULL DEFAULT 'resend', "apiKey" TEXT,
  "fromAddress" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "PortalBranding" (
  "id" INTEGER NOT NULL PRIMARY KEY, "brandName" TEXT, "logoData" BYTEA, "logoMime" TEXT,
  "logoWidth" INTEGER, "logoHeight" INTEGER, "logoSize" INTEGER, "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "networks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "networkConfig" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_engineId_tag_key" ON "Tenant"("engineId", "tag");

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsed" TIMESTAMP(3),
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_userId_fkey') THEN
    ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ResetToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResetToken_tokenHash_key" ON "ResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ResetToken_expiresAt_idx" ON "ResetToken"("expiresAt");

CREATE TABLE IF NOT EXISTS "TwoFactorChallenge" (
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TwoFactorChallenge_pkey" PRIMARY KEY ("email")
);
CREATE INDEX IF NOT EXISTS "TwoFactorChallenge_expiresAt_idx" ON "TwoFactorChallenge"("expiresAt");

CREATE TABLE IF NOT EXISTS "SystemSecret" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemSecret_pkey" PRIMARY KEY ("key")
);
