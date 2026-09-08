-- Add type column to Engine ("olvm" | "vmware"); existing engines stay olvm.
ALTER TABLE "Engine" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'olvm';
