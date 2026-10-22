-- Credenciales SSH de los hosts ESXi del engine (para vmkfstools en imports de disco real)
ALTER TABLE "Engine" ADD COLUMN "hostSshUser" TEXT;
ALTER TABLE "Engine" ADD COLUMN "hostSshPassword" TEXT;
