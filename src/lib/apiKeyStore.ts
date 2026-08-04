import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export type ApiKey = {
  id: string;
  key: string;
  name: string;
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

export const createApiKey = async (name: string): Promise<ApiKey> => {
  const keys = await listApiKeys();
  const newKey: ApiKey = {
    id: crypto.randomUUID(),
    key: crypto.randomBytes(24).toString("hex"),
    name: name.trim() || "Unnamed",
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

export const validateApiKey = async (providedKey: string): Promise<boolean> => {
  const envKey = process.env.API_READ_KEY?.trim();
  if (envKey && providedKey === envKey) return true;
  const keys = await listApiKeys();
  const match = keys.find((k) => k.active && k.key === providedKey);
  if (match) {
    match.lastUsed = new Date().toISOString();
    await saveKeys(keys).catch(() => undefined);
    return true;
  }
  return false;
};
