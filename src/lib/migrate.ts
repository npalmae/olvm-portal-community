import fs from "fs";
import path from "path";
import { prisma } from "./prisma";

type LegacyUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  tenantId?: string;
  role?: string;
  globalRole?: string | null;
  defaultTenantId?: string;
  memberships?: { tenantId: string; role: string }[];
  twoFactorEnabled?: boolean;
  createdAt?: string;
};

type LegacyEngine = {
  id: string;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  caCert?: string;
  sharedStorageDomains?: string[];
  brandName?: string;
  brandLogoUrl?: string;
  createdAt?: string;
};

type LegacyTenant = {
  id: string;
  name: string;
  engineId: string;
  tag?: string;
  storageDomains?: string[];
  createdAt?: string;
};

export const migrateJsonToPostgres = async () => {
  const dataDir = path.join(process.cwd(), "data");
  let migrated = 0;

  // Migrar engines
  try {
    const enginesPath = path.join(dataDir, "engines.json");
    if (fs.existsSync(enginesPath)) {
      const engines = JSON.parse(fs.readFileSync(enginesPath, "utf8")) as LegacyEngine[];
      for (const e of engines) {
        const exists = await prisma.engine.findUnique({ where: { id: e.id } });
        if (!exists) {
          await prisma.engine.create({
            data: {
              id: e.id,
              name: e.name,
              baseUrl: e.baseUrl,
              username: e.username,
              password: e.password,
              token: e.token,
              allowInsecure: e.allowInsecure ?? false,
              caCert: e.caCert,
              sharedStorageDomains: e.sharedStorageDomains ?? [],
              brandName: e.brandName,
              brandLogoUrl: e.brandLogoUrl,
            },
          });
          migrated++;
        }
      }
      if (migrated > 0) console.log(`[migrate] ${migrated} engines migrados`);
    }
  } catch (e) {
    console.error("[migrate] Error migrando engines:", (e as Error).message);
  }

  // Migrar tenants
  let tenantsMigrated = 0;
  try {
    const tenantsPath = path.join(dataDir, "clusters.json");
    if (fs.existsSync(tenantsPath)) {
      const tenants = JSON.parse(fs.readFileSync(tenantsPath, "utf8")) as LegacyTenant[];
      for (const t of tenants) {
        const exists = await prisma.tenant.findUnique({ where: { id: t.id } });
        if (!exists) {
          await prisma.tenant.create({
            data: {
              id: t.id,
              name: t.name,
              engineId: t.engineId,
              tag: t.tag,
              storageDomains: t.storageDomains ?? [],
            },
          });
          tenantsMigrated++;
        }
      }
      if (tenantsMigrated > 0) console.log(`[migrate] ${tenantsMigrated} tenants migrados`);
    }
  } catch (e) {
    console.error("[migrate] Error migrando tenants:", (e as Error).message);
  }

  // Migrar users
  let usersMigrated = 0;
  try {
    const usersPath = path.join(dataDir, "users.json");
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, "utf8")) as LegacyUser[];
      for (const u of users) {
        const exists = await prisma.user.findUnique({ where: { email: u.email } });
        if (!exists) {
          const globalRole = u.globalRole ?? (u.role === "superadmin" ? "superadmin" : null);
          const memberships = u.memberships ?? (u.tenantId && u.tenantId !== "default" ? [{ tenantId: u.tenantId, role: u.role === "admin" ? "admin" : "user" }] : []);

          const created = await prisma.user.create({
            data: {
              id: u.id,
              email: u.email,
              password: u.password,
              name: u.name,
              globalRole,
              defaultTenantId: u.defaultTenantId && u.defaultTenantId !== "default" ? u.defaultTenantId : null,
              twoFactorEnabled: u.twoFactorEnabled !== false,
              memberships: {
                create: memberships.map((m) => ({
                  tenantId: m.tenantId,
                  role: m.role,
                })),
              },
            },
          });
          usersMigrated++;
        }
      }
      if (usersMigrated > 0) console.log(`[migrate] ${usersMigrated} usuarios migrados`);
    }
  } catch (e) {
    console.error("[migrate] Error migrando users:", (e as Error).message);
  }

  const total = migrated + tenantsMigrated + usersMigrated;
  if (total > 0) {
    console.log(`[migrate] Migracion completa: ${total} registros`);
  } else {
    console.log("[migrate] No habia datos JSON para migrar (o ya estaban migrados)");
  }
  return total;
};
