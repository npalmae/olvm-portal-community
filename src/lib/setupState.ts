import { prisma } from "./prisma";

export const isSetupComplete = async (): Promise<boolean> => {
  const count = await prisma.user.count({ where: { globalRole: "superadmin" } });
  return count > 0;
};

export const getSetupStatus = async () => {
  const [superadminCount, engineCount, tenantCount] = await Promise.all([
    prisma.user.count({ where: { globalRole: "superadmin" } }),
    prisma.engine.count(),
    prisma.tenant.count(),
  ]);
  const email = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  const sshSecret = await prisma.systemSecret.findUnique({ where: { key: "OLVM_HOST_SSH_PASSWORD" } });
  return {
    setupComplete: superadminCount > 0,
    hasSuperadmin: superadminCount > 0,
    hasEngine: engineCount > 0,
    hasTenant: tenantCount > 0,
    hasEmail: Boolean(email?.apiKey),
    hasSshSecret: Boolean(sshSecret),
  };
};
