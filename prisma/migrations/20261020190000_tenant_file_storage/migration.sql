-- Almacenamiento designado por tenant para archivos (ISO/OVA)
ALTER TABLE "Tenant" ADD COLUMN "fileStorageDomain" TEXT;
