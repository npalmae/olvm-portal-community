import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

type InitialSuperadminInput = {
  name: string;
  email: string;
  password: string;
};

// PostgreSQL advisory locking makes the first-admin claim atomic even when two
// unauthenticated setup requests arrive at the same time.
export const createInitialSuperadmin = async (input: InitialSuperadminInput) => {
  const email = input.email.trim().toLowerCase();
  const password = await bcrypt.hash(input.password, 10);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(718214963)");
    const existing = await tx.user.count({ where: { globalRole: "superadmin" } });
    if (existing > 0) return null;

    const user = await tx.user.create({
      data: {
        email,
        password,
        name: input.name.trim(),
        globalRole: "superadmin",
        twoFactorEnabled: false,
      },
      select: { id: true },
    });
    return user.id;
  });
};

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
