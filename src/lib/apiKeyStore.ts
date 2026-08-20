import crypto from "crypto";
import { prisma } from "./prisma";
import { hashToken, safeEqualHash } from "./crypto";
import { getSystemSecretWithEnvFallback, SYSTEM_SECRET_KEYS } from "./systemSecretStore";

export type ApiKey = {
  id: string; key: string; name: string; userId: string; userEmail: string;
  createdAt: string; active: boolean; lastUsed?: string;
};

const toApiKey = (row: Awaited<ReturnType<typeof prisma.apiKey.findFirst>> extends infer T ? NonNullable<T> : never): ApiKey => ({
  id: row.id, key: row.keyPrefix, name: row.name, userId: row.userId, userEmail: row.userEmail,
  createdAt: row.createdAt.toISOString(), active: row.active, lastUsed: row.lastUsed?.toISOString(),
});

export const listApiKeys = async (): Promise<ApiKey[]> =>
  (await prisma.apiKey.findMany({ orderBy: { createdAt: "asc" } })).map(toApiKey);

export const listKeysByUser = async (userId: string): Promise<ApiKey[]> =>
  (await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })).map(toApiKey);

export const createApiKey = async (name: string, userId: string, userEmail: string): Promise<ApiKey> => {
  const key = crypto.randomBytes(24).toString("hex");
  const row = await prisma.apiKey.create({ data: {
    id: crypto.randomUUID(), keyHash: hashToken(key), keyPrefix: key.slice(0, 8),
    name: name.trim() || "Unnamed", userId, userEmail, active: true,
  } });
  return { ...toApiKey(row), key };
};

export const deleteApiKey = async (id: string): Promise<void> => {
  await prisma.apiKey.deleteMany({ where: { id } });
};

export const toggleApiKey = async (id: string): Promise<void> => {
  const row = await prisma.apiKey.findUnique({ where: { id } });
  if (row) await prisma.apiKey.update({ where: { id }, data: { active: !row.active } });
};

export type ApiKeyContext = {
  userId: string;
  userEmail: string;
  globalRole: string | null;
  tenantIds: string[];
  tenantRoles: Record<string, string>;
};

export const validateApiKey = async (providedKey: string): Promise<ApiKeyContext | null> => {
  const bootstrapKey = await getSystemSecretWithEnvFallback(SYSTEM_SECRET_KEYS.apiReadKey);
  if (bootstrapKey) {
    const providedHash = hashToken(providedKey);
    if (safeEqualHash(providedHash, hashToken(bootstrapKey))) return { userId: "system", userEmail: "system-key", globalRole: "superadmin", tenantIds: [], tenantRoles: {} };
  }
  const keyHash = hashToken(providedKey);
  const match = await prisma.apiKey.findUnique({ where: { keyHash }, include: { user: { include: { memberships: true } } } });
  if (!match?.active || !safeEqualHash(keyHash, match.keyHash)) return null;
  await prisma.apiKey.update({ where: { id: match.id }, data: { lastUsed: new Date() } }).catch(() => undefined);
  const tenantRoles: Record<string, string> = {};
  for (const membership of match.user.memberships) tenantRoles[membership.tenantId] = membership.role;
  return {
    userId: match.user.id, userEmail: match.user.email, globalRole: match.user.globalRole,
    tenantIds: match.user.memberships.map((membership) => membership.tenantId),
    tenantRoles,
  };
};
