const { PrismaClient, Prisma } = require("@prisma/client");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const dataDir = path.join(process.cwd(), "data");
const prefix = "enc:v1:";

function encryptionKey() {
  const value = (process.env.FIELD_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(value, "base64");
  if (!value || key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("FIELD_ENCRYPTION_KEY must be base64 and decode to exactly 32 bytes");
  }
  return key;
}

function encrypt(value) {
  if (!value || value.startsWith(prefix)) return value || null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (value) => crypto.createHmac("sha256", encryptionKey()).update(value).digest("hex");
const readJson = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8")); }
  catch { return fallback; }
};

async function migrate() {
  encryptionKey();
  let total = 0;

  for (const e of readJson("engines.json", [])) {
    const data = {
      id: e.id, name: e.name, baseUrl: e.baseUrl, username: e.username || null,
      password: encrypt(e.password), token: encrypt(e.token), allowInsecure: e.allowInsecure === true,
      caCert: encrypt(e.caCert), sharedStorageDomains: e.sharedStorageDomains || [],
      brandName: e.brandName || null, brandLogoUrl: e.brandLogoUrl || null, createdAt: e.createdAt ? new Date(e.createdAt) : undefined,
    };
    await prisma.engine.upsert({ where: { id: e.id }, create: data, update: data });
    total++;
  }

  for (const t of readJson("clusters.json", [])) {
    let engineId = t.engineId;
    if (!engineId && t.baseUrl) {
      const baseUrl = String(t.baseUrl).replace(/\/$/, "");
      const existing = await prisma.engine.findFirst({ where: { baseUrl, username: t.username || null } });
      engineId = existing?.id || `engine-${baseUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
      const engineData = {
        id: engineId, name: `Engine ${new URL(baseUrl).host}`, baseUrl, username: t.username || null,
        password: encrypt(t.password), token: encrypt(t.token), allowInsecure: t.allowInsecure === true,
        caCert: encrypt(t.caCert), sharedStorageDomains: [],
      };
      await prisma.engine.upsert({ where: { id: engineId }, create: engineData, update: engineData });
    }
    if (!engineId) continue;
    const data = {
      id: t.id, name: t.name, engineId, tag: t.tag || null,
      storageDomains: t.storageDomains || [], networks: t.networks || [],
      networkConfig: t.networkConfig || Prisma.JsonNull, createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
    };
    await prisma.tenant.upsert({ where: { id: t.id }, create: data, update: data });
    total++;
  }

  for (const u of readJson("users.json", [])) {
    const memberships = u.memberships || (u.tenantId && u.tenantId !== "default" ? [{ tenantId: u.tenantId, role: u.role === "operator" ? "operator" : u.role === "admin" ? "admin" : "user" }] : []);
    const validMemberships = [];
    for (const membership of memberships) {
      if (await prisma.tenant.findUnique({ where: { id: membership.tenantId } })) validMemberships.push(membership);
    }
    const userData = {
      id: u.id, email: u.email.toLowerCase(), password: u.password, name: u.name,
      globalRole: u.globalRole || (u.role === "superadmin" ? "superadmin" : null),
      defaultTenantId: u.defaultTenantId && u.defaultTenantId !== "default" ? u.defaultTenantId : null,
      twoFactorEnabled: u.twoFactorEnabled !== false, createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
    };
    await prisma.user.upsert({ where: { id: u.id }, create: userData, update: userData });
    const tenantIds = validMemberships.map((m) => m.tenantId);
    await prisma.membership.deleteMany({ where: {
      userId: u.id,
      ...(tenantIds.length ? { tenantId: { notIn: tenantIds } } : {}),
    } });
    for (const membership of validMemberships) {
      const role = membership.role === "operator" ? "operator" : membership.role === "admin" ? "admin" : "user";
      await prisma.membership.upsert({
        where: { userId_tenantId: { userId: u.id, tenantId: membership.tenantId } },
        create: { userId: u.id, tenantId: membership.tenantId, role },
        update: { role },
      });
    }
    total++;
  }

  for (const k of readJson("api-keys.json", [])) {
    if (!k.key || !await prisma.user.findUnique({ where: { id: k.userId } })) continue;
    const data = {
      id: k.id, keyHash: hash(k.key), keyPrefix: k.key.slice(0, 8), name: k.name,
      userId: k.userId, userEmail: k.userEmail, active: k.active !== false,
      createdAt: k.createdAt ? new Date(k.createdAt) : undefined, lastUsed: k.lastUsed ? new Date(k.lastUsed) : undefined,
    };
    await prisma.apiKey.upsert({ where: { keyHash: hash(k.key) }, create: data, update: data });
    total++;
  }

  for (const t of readJson("reset-tokens.json", [])) {
    const data = {
      tokenHash: hash(t.token), email: t.email.toLowerCase(), expiresAt: new Date(t.expiresAt), used: t.used === true,
    };
    await prisma.resetToken.upsert({ where: { tokenHash: hash(t.token) }, create: data, update: data });
    total++;
  }

  for (const [email, challenge] of Object.entries(readJson("two-factor-challenges.json", {}))) {
    const data = {
      email: email.toLowerCase(), codeHash: hmac(`${email.toLowerCase()}:${challenge.code}`),
      expiresAt: new Date(challenge.expiresAt), attempts: challenge.attempts || 0, createdAt: new Date(challenge.createdAt),
    };
    await prisma.twoFactorChallenge.upsert({ where: { email: email.toLowerCase() }, create: data, update: data });
    total++;
  }

  const branding = readJson("branding.json", null);
  const logoPath = path.join(dataDir, "branding-logo.png");
  if (branding || fs.existsSync(logoPath)) {
    const data = {
      id: 1, brandName: branding?.brandName, logoMime: branding?.logoMime,
      logoWidth: branding?.logoWidth, logoHeight: branding?.logoHeight, logoSize: branding?.logoSize,
      logoData: fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : undefined,
    };
    await prisma.portalBranding.upsert({ where: { id: 1 }, create: data, update: data });
    total++;
  }

  for (const engine of await prisma.engine.findMany()) {
    const data = {};
    for (const field of ["password", "token", "caCert"]) if (engine[field] && !engine[field].startsWith(prefix)) data[field] = encrypt(engine[field]);
    if (Object.keys(data).length) await prisma.engine.update({ where: { id: engine.id }, data });
  }
  const email = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  const resendKey = email?.apiKey && !email.apiKey.startsWith(prefix)
    ? email.apiKey
    : !email?.apiKey ? process.env.RESEND_API_KEY : null;
  if (!email && resendKey) {
    await prisma.emailConfig.create({ data: { id: 1, provider: "resend", apiKey: encrypt(resendKey), fromAddress: process.env.RESEND_FROM || null, enabled: true } });
  } else if (email && resendKey) {
    await prisma.emailConfig.update({ where: { id: 1 }, data: { apiKey: encrypt(resendKey) } });
  }

  for (const key of ["OLVM_HOST_SSH_USER", "OLVM_HOST_SSH_PASSWORD", "API_READ_KEY"]) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    const encrypted = encrypt(value);
    await prisma.systemSecret.upsert({ where: { key }, create: { key, value: encrypted }, update: { value: encrypted } });
  }

  console.log(`[migrate] complete: ${total} source records inspected; originals retained`);
}

migrate().finally(() => prisma.$disconnect()).catch((error) => { console.error("[migrate] failed:", error.message); process.exitCode = 1; });
