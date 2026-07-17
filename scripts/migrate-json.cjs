const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const dataDir = path.join(process.cwd(), "data");

async function migrate() {
  let total = 0;

  // Engines
  try {
    const engines = JSON.parse(fs.readFileSync(path.join(dataDir, "engines.json"), "utf8"));
    for (const e of engines) {
      const exists = await prisma.engine.findUnique({ where: { id: e.id } });
      if (!exists) {
        await prisma.engine.create({
          data: {
            id: e.id, name: e.name, baseUrl: e.baseUrl,
            username: e.username, password: e.password, token: e.token,
            allowInsecure: e.allowInsecure ?? false, caCert: e.caCert,
            sharedStorageDomains: e.sharedStorageDomains ?? [],
            brandName: e.brandName, brandLogoUrl: e.brandLogoUrl,
          },
        });
        total++;
      }
    }
    console.log(`[migrate] ${engines.length} engines, ${total} nuevos`);
  } catch (e) { console.error("[migrate] engines error:", e.message); }

  // Tenants
  let tCount = 0;
  try {
    const tenants = JSON.parse(fs.readFileSync(path.join(dataDir, "clusters.json"), "utf8"));
    for (const t of tenants) {
      const exists = await prisma.tenant.findUnique({ where: { id: t.id } });
      if (!exists) {
        await prisma.tenant.create({
          data: { id: t.id, name: t.name, engineId: t.engineId, tag: t.tag, storageDomains: t.storageDomains ?? [] },
        });
        tCount++;
      }
    }
    console.log(`[migrate] ${tenants.length} tenants, ${tCount} nuevos`);
  } catch (e) { console.error("[migrate] tenants error:", e.message); }

  // Users + Memberships
  let uCount = 0;
  try {
    const users = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"));
    for (const u of users) {
      const exists = await prisma.user.findUnique({ where: { email: u.email } });
      if (!exists) {
        const memberships = u.memberships ?? (u.tenantId && u.tenantId !== "default" ? [{ tenantId: u.tenantId, role: u.role === "admin" ? "admin" : "user" }] : []);
        await prisma.user.create({
          data: {
            id: u.id, email: u.email, password: u.password, name: u.name,
            globalRole: u.globalRole ?? (u.role === "superadmin" ? "superadmin" : null),
            defaultTenantId: u.defaultTenantId && u.defaultTenantId !== "default" ? u.defaultTenantId : null,
            twoFactorEnabled: u.twoFactorEnabled !== false,
            memberships: { create: memberships.map((m) => ({ tenantId: m.tenantId, role: m.role })) },
          },
        });
        uCount++;
      }
    }
    console.log(`[migrate] ${users.length} usuarios, ${uCount} nuevos`);
  } catch (e) { console.error("[migrate] users error:", e.message); }

  total += tCount + uCount;
  console.log(`[migrate] Migracion completa: ${total} registros nuevos`);
  return total;
}

migrate()
  .then((r) => { console.log("DONE:", r); process.exit(0); })
  .catch((e) => { console.error("ERROR:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
