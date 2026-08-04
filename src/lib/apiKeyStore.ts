import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export type ApiKey = {
  id: string;
  key: string;
  name: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  active: boolean;
  lastUsed?: string;
};

const STORE_PATH = () =>
  process.env.API_KEY_STORE_PATH?.trim() ||
  path.join(process.cwd(), "data", "api-keys.json");

export const listApiKeys = async (): Promise<ApiKey[]> => {
  try {
    const raw = await fs.readFile(STORE_PATH(), "utf8");
    return JSON.parse(raw) as ApiKey[];
  } catch {
    return [];
  }
};

const saveKeys = async (keys: ApiKey[]) => {
  const file = STORE_PATH();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
};

export const listKeysByUser = async (userId: string): Promise<ApiKey[]> => {
  return (await listApiKeys()).filter((k) => k.userId === userId);
};

export const createApiKey = async (name: string, userId: string, userEmail: string): Promise<ApiKey> => {
  const keys = await listApiKeys();
  const newKey: ApiKey = {
    id: crypto.randomUUID(),
    key: crypto.randomBytes(24).toString("hex"),
    name: name.trim() || "Unnamed",
    userId,
    userEmail,
    createdAt: new Date().toISOString(),
    active: true,
  };
  keys.push(newKey);
  await saveKeys(keys);
  return newKey;
};

export const deleteApiKey = async (id: string): Promise<void> => {
  const keys = await listApiKeys();
  await saveKeys(keys.filter((k) => k.id !== id));
};

export const toggleApiKey = async (id: string): Promise<void> => {
  const keys = await listApiKeys();
  const key = keys.find((k) => k.id === id);
  if (key) {
    key.active = !key.active;
    await saveKeys(keys);
  }
};

export type ApiKeyContext = {
  userId: string;
  userEmail: string;
  globalRole: string | null;
  tenantIds: string[];
};

export const validateApiKey = async (providedKey: string): Promise<ApiKeyContext | null> => {
  const envKey = process.env.API_READ_KEY?.trim();
  if (envKey && providedKey === envKey) {
    return { userId: "env", userEmail: "env-key", globalRole: "superadmin", tenantIds: [] };
  }
  const keys = await listApiKeys();
  const match = keys.find((k) => k.active && k.key === providedKey);
  if (!match) return null;

  match.lastUsed = new Date().toISOString();
  await saveKeys(keys).catch(() => undefined);

  const { listUsers } = await import("./userStore");
  const users = await listUsers();
  const user = users.find((u) => u.id === match.userId);
  if (!user) return null;

  const tenantIds = (user.memberships ?? []).map((m) => m.tenantId);
  return {
    userId: user.id,
    userEmail: user.email,
    globalRole: user.globalRole ?? null,
    tenantIds,
  };
};
