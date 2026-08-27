import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { encryptField, hashShortLivedSecret, hashToken, isEncrypted } from "./crypto";
import { setSystemSecret } from "./systemSecretStore";

type JsonRecord = Record<string, unknown>;

const readJson = <T>(dataDir: string, file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) as T;
  } catch {
    return fallback;
  }
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

export const migrateJsonToPostgres = async (): Promise<number> => {
  const dataDir = path.join(process.cwd(), "data");
  let reconciled = 0;

  for (const engine of readJson<JsonRecord[]>(dataDir, "engines.json", [])) {
    const id = String(engine.id);
    const data = {
      id,
      name: String(engine.name),
      baseUrl: String(engine.baseUrl).replace(/\/$/, ""),
      username: engine.username ? String(engine.username) : null,
      password: encryptField(engine.password ? String(engine.password) : null),
      token: encryptField(engine.token ? String(engine.token) : null),
      allowInsecure: engine.allowInsecure === true,
      caCert: encryptField(engine.caCert ? String(engine.caCert) : null),
      sharedStorageDomains: strings(engine.sharedStorageDomains),
      brandName: engine.brandName ? String(engine.brandName) : null,
      brandLogoUrl: engine.brandLogoUrl ? String(engine.brandLogoUrl) : null,
      createdAt: engine.createdAt ? new Date(String(engine.createdAt)) : undefined,
    };
    await prisma.engine.upsert({ where: { id }, create: data, update: data });
    reconciled++;
  }

  for (const tenant of readJson<JsonRecord[]>(dataDir, "clusters.json", [])) {
    let engineId = tenant.engineId ? String(tenant.engineId) : "";
    if (!engineId && tenant.baseUrl) {
      const baseUrl = String(tenant.baseUrl).replace(/\/$/, "");
      const username = tenant.username ? String(tenant.username) : null;
      const existing = await prisma.engine.findFirst({ where: { baseUrl, username } });
      engineId = existing?.id ?? `engine-${baseUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
      const engineData = {
        id: engineId,
        name: `Engine ${new URL(baseUrl).host}`,
        baseUrl,
        username,
        password: encryptField(tenant.password ? String(tenant.password) : null),
        token: encryptField(tenant.token ? String(tenant.token) : null),
        allowInsecure: tenant.allowInsecure === true,
        caCert: encryptField(tenant.caCert ? String(tenant.caCert) : null),
        sharedStorageDomains: [] as string[],
      };
      await prisma.engine.upsert({ where: { id: engineId }, create: engineData, update: engineData });
    }
    if (!engineId) continue;
    const id = String(tenant.id);
    const data = {
      id,
      name: String(tenant.name),
      engineId,
      tag: tenant.tag ? String(tenant.tag) : null,
      storageDomains: strings(tenant.storageDomains),
      networks: strings(tenant.networks),
      networkConfig: Array.isArray(tenant.networkConfig) ? tenant.networkConfig as Prisma.InputJsonValue : Prisma.JsonNull,
      createdAt: tenant.createdAt ? new Date(String(tenant.createdAt)) : undefined,
    };
    await prisma.tenant.upsert({ where: { id }, create: data, update: data });
    reconciled++;
  }

  for (const user of readJson<JsonRecord[]>(dataDir, "users.json", [])) {
    const id = String(user.id);
    const email = String(user.email).toLowerCase();
    const memberships = Array.isArray(user.memberships)
      ? user.memberships as JsonRecord[]
      : user.tenantId && user.tenantId !== "default"
        ? [{ tenantId: user.tenantId, role: user.role === "operator" ? "operator" : user.role === "admin" ? "admin" : "user" }]
        : [];
    const validMemberships: Array<{ tenantId: string; role: string }> = [];
    for (const membership of memberships) {
      const tenantId = String(membership.tenantId);
      if (await prisma.tenant.findUnique({ where: { id: tenantId } })) {
        validMemberships.push({ tenantId, role: membership.role === "operator" ? "operator" : membership.role === "admin" ? "admin" : "user" });
      }
    }
    const data = {
      id,
      email,
      password: String(user.password),
      name: String(user.name),
      globalRole: user.globalRole === "superadmin" || user.role === "superadmin" ? "superadmin" : null,
      defaultTenantId: user.defaultTenantId && user.defaultTenantId !== "default" ? String(user.defaultTenantId) : null,
      twoFactorEnabled: user.twoFactorEnabled !== false,
      createdAt: user.createdAt ? new Date(String(user.createdAt)) : undefined,
    };
    await prisma.user.upsert({ where: { id }, create: data, update: data });
    const tenantIds = validMemberships.map((membership) => membership.tenantId);
    await prisma.membership.deleteMany({
      where: { userId: id, ...(tenantIds.length ? { tenantId: { notIn: tenantIds } } : {}) },
    });
    for (const membership of validMemberships) {
      await prisma.membership.upsert({
        where: { userId_tenantId: { userId: id, tenantId: membership.tenantId } },
        create: { userId: id, ...membership },
        update: { role: membership.role },
      });
    }
    reconciled++;
  }

  for (const key of readJson<JsonRecord[]>(dataDir, "api-keys.json", [])) {
    if (!key.key || !key.userId || !await prisma.user.findUnique({ where: { id: String(key.userId) } })) continue;
    const raw = String(key.key);
    const data = {
      id: String(key.id), keyHash: hashToken(raw), keyPrefix: raw.slice(0, 8),
      name: String(key.name ?? "Unnamed"), userId: String(key.userId), userEmail: String(key.userEmail ?? ""),
      active: key.active !== false, createdAt: key.createdAt ? new Date(String(key.createdAt)) : undefined,
      lastUsed: key.lastUsed ? new Date(String(key.lastUsed)) : null,
    };
    await prisma.apiKey.upsert({ where: { keyHash: data.keyHash }, create: data, update: data });
  }

  for (const token of readJson<JsonRecord[]>(dataDir, "reset-tokens.json", [])) {
    if (!token.token) continue;
    const tokenHash = hashToken(String(token.token));
    const data = { tokenHash, email: String(token.email).toLowerCase(), expiresAt: new Date(Number(token.expiresAt)), used: token.used === true };
    await prisma.resetToken.upsert({ where: { tokenHash }, create: data, update: data });
  }

  const challenges = readJson<Record<string, JsonRecord>>(dataDir, "two-factor-challenges.json", {});
  for (const [email, challenge] of Object.entries(challenges)) {
    const normalized = email.toLowerCase();
    const data = {
      email: normalized,
      codeHash: hashShortLivedSecret(`${normalized}:${String(challenge.code)}`),
      expiresAt: new Date(Number(challenge.expiresAt)), attempts: Number(challenge.attempts) || 0,
      createdAt: new Date(Number(challenge.createdAt)),
    };
    await prisma.twoFactorChallenge.upsert({ where: { email: normalized }, create: data, update: data });
  }

  for (const engine of await prisma.engine.findMany()) {
    const data: { password?: string; token?: string; caCert?: string } = {};
    if (engine.password && !isEncrypted(engine.password)) data.password = encryptField(engine.password)!;
    if (engine.token && !isEncrypted(engine.token)) data.token = encryptField(engine.token)!;
    if (engine.caCert && !isEncrypted(engine.caCert)) data.caCert = encryptField(engine.caCert)!;
    if (Object.keys(data).length) await prisma.engine.update({ where: { id: engine.id }, data });
  }

  const email = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  const resendKey = email?.apiKey && !isEncrypted(email.apiKey)
    ? email.apiKey
    : !email?.apiKey ? process.env.RESEND_API_KEY?.trim() : null;
  if (!email && resendKey) {
    await prisma.emailConfig.create({ data: {
      id: 1, provider: "resend", apiKey: encryptField(resendKey),
      fromAddress: process.env.RESEND_FROM ?? null, enabled: true,
    } });
  } else if (email && resendKey) {
    await prisma.emailConfig.update({ where: { id: 1 }, data: { apiKey: encryptField(resendKey) } });
  }

  for (const key of ["OLVM_HOST_SSH_USER", "OLVM_HOST_SSH_PASSWORD", "API_READ_KEY"]) {
    const value = process.env[key]?.trim();
    if (value) await setSystemSecret(key, value);
  }

  return reconciled;
};
