import { prisma } from "./prisma";
import { decryptField, encryptField } from "./crypto";

export const SYSTEM_SECRET_KEYS = {
  hostSshUser: "OLVM_HOST_SSH_USER",
  hostSshPassword: "OLVM_HOST_SSH_PASSWORD",
  apiReadKey: "API_READ_KEY",
} as const;

export const getSystemSecret = async (key: string): Promise<string | null> => {
  const secret = await prisma.systemSecret.findUnique({ where: { key } });
  return secret ? decryptField(secret.value) ?? null : null;
};

export const setSystemSecret = async (key: string, value: string): Promise<void> => {
  const encrypted = encryptField(value);
  if (!encrypted) throw new Error("System secret value cannot be empty");
  await prisma.systemSecret.upsert({
    where: { key },
    create: { key, value: encrypted },
    update: { value: encrypted },
  });
};

export const getSystemSecretWithEnvFallback = async (
  key: string,
  envName: string = key,
): Promise<string | null> =>
  await getSystemSecret(key) ?? process.env[envName]?.trim() ?? null;
