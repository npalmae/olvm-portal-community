import crypto from "crypto";

const ENVELOPE_VERSION = "enc:v1";

export const getFieldEncryptionKey = (): Buffer => {
  const value = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("FIELD_ENCRYPTION_KEY is required");

  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    throw new Error("FIELD_ENCRYPTION_KEY must be base64 encoded");
  }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
};

export const isEncrypted = (value: string): boolean =>
  value.startsWith(`${ENVELOPE_VERSION}:`);

export const encryptField = (value?: string | null): string | null => {
  if (!value) return null;
  if (isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getFieldEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
};

export const decryptField = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  if (!isEncrypted(value)) throw new Error("Refusing to decrypt a plaintext field");
  const [, , ivValue, tagValue, ciphertextValue] = value.split(":");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted field envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getFieldEncryptionKey(), Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

export const hashToken = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

export const hashShortLivedSecret = (value: string): string =>
  crypto.createHmac("sha256", getFieldEncryptionKey()).update(value).digest("hex");

export const safeEqualHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
