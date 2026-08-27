import crypto from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { decryptField, encryptField } from "./crypto";
import { prisma } from "./prisma";

export const BACKUP_FREQUENCIES = ["manual", "6h", "12h", "daily", "weekly", "monthly"] as const;
export const BACKUP_PROFILES = ["operational", "full"] as const;

export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];
export type BackupProfile = (typeof BACKUP_PROFILES)[number];

export type BackupStorageConfig = {
  provider: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  enabled: boolean;
  scheduleEnabled: boolean;
  frequency: BackupFrequency;
  scheduleHour: number;
  scheduleWeekday: number;
  retentionDays: number;
  retentionCount: number;
  defaultProfile: BackupProfile;
  lastScheduledAt: Date | null;
  nextRunAt: Date | null;
};

export type BackupStorageConfigInput = Partial<Omit<BackupStorageConfig, "provider">> & {
  provider?: "s3";
};

export type PublicBackupStorageConfig = Omit<BackupStorageConfig, "accessKey" | "secretKey"> & {
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  accessKeyHint: string | null;
  secretKeyHint: string | null;
};

export type BackupObjectMetadata = {
  size: number | null;
  etag: string | null;
  contentType: string | null;
  lastModified: Date | null;
};

const DEFAULTS: Omit<BackupStorageConfig, "endpoint" | "region" | "bucket" | "accessKey" | "secretKey"> = {
  provider: "s3",
  prefix: "backups/bastion",
  forcePathStyle: true,
  enabled: true,
  scheduleEnabled: false,
  frequency: "daily",
  scheduleHour: 2,
  scheduleWeekday: 0,
  retentionDays: 30,
  retentionCount: 30,
  defaultProfile: "operational",
  lastScheduledAt: null,
  nextRunAt: null,
};

const parseIpv6 = (address: string): number[] | null => {
  let value = address.toLowerCase();
  const ipv4Tail = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = `${value.slice(0, -ipv4Tail.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  if (value.split("::").length > 2) return null;
  const [left, right = ""] = value.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if ((value.includes("::") ? missing < 1 : missing !== 0)) return null;
  const parts = [...leftParts, ...Array(missing).fill("0"), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.flatMap((part) => {
    const word = Number.parseInt(part, 16);
    return [word >>> 8, word & 0xff];
  });
};

const inCidr = (bytes: number[], network: number[], prefix: number): boolean => {
  const wholeBytes = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;
  if (bytes.slice(0, wholeBytes).some((byte, index) => byte !== network[index])) return false;
  if (!remainingBits) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (network[wholeBytes] & mask);
};

export const isPublicIpAddress = (address: string): boolean => {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(host);
  if (version === 4) {
    const bytes = host.split(".").map(Number);
    const [a, b, c, d] = bytes;
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) || (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || a >= 224);
  }
  if (version !== 6) return false;
  const bytes = parseIpv6(host);
  if (!bytes) return false;
  const mappedPrefix = Array(10).fill(0).concat([0xff, 0xff]);
  if (inCidr(bytes, mappedPrefix, 96)) return isPublicIpAddress(bytes.slice(12).join("."));

  // Globally routable IPv6 is currently allocated from 2000::/3; special-purpose ranges within it remain blocked.
  if (!inCidr(bytes, [0x20, 0x00], 3)) return false;
  if (inCidr(bytes, [0x20, 0x01, 0x00], 23) || inCidr(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    inCidr(bytes, [0x20, 0x02], 16) || inCidr(bytes, [0x3f, 0xff, 0x00], 20)) return false;
  return true;
};

const normalizeEndpoint = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Backup endpoint must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("Backup endpoint must use HTTPS");
  if (url.username || url.password) throw new Error("Backup endpoint must not contain credentials");
  if (url.search || url.hash) throw new Error("Backup endpoint must not contain a query or fragment");
  if (url.pathname !== "/") throw new Error("Backup endpoint must not contain a path");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 && !isPublicIpAddress(hostname))) {
    throw new Error("Backup endpoint host is not allowed");
  }
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
};

const requireInteger = (name: string, value: number, min: number, max: number): void => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
};

export const validateBackupStorageConfig = (config: BackupStorageConfig): BackupStorageConfig => {
  if (config.provider !== "s3") throw new Error("Backup provider must be s3");
  const endpoint = normalizeEndpoint(config.endpoint);
  const region = config.region.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(region)) throw new Error("Backup region is invalid");
  const bucket = config.bucket.trim();
  if (bucket.length < 3 || bucket.length > 63 || bucket.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)) || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error("Backup bucket is invalid");
  }
  const prefix = config.prefix.trim().replace(/^\/+|\/+$/g, "");
  if (prefix.length > 512 || (prefix !== "" && prefix.split("/").some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9!_.*'()-]+$/.test(part)))) {
    throw new Error("Backup prefix is invalid");
  }
  if (!config.accessKey.trim()) throw new Error("Backup access key is required");
  if (!config.secretKey.trim()) throw new Error("Backup secret key is required");
  if (!BACKUP_FREQUENCIES.includes(config.frequency)) throw new Error("Backup frequency is invalid");
  if (!BACKUP_PROFILES.includes(config.defaultProfile)) throw new Error("Backup profile is invalid");
  requireInteger("Schedule hour", config.scheduleHour, 0, 23);
  requireInteger("Schedule weekday", config.scheduleWeekday, 0, 6);
  requireInteger("Retention days", config.retentionDays, 1, 3650);
  requireInteger("Retention count", config.retentionCount, 1, 1000);
  if (config.lastScheduledAt !== null && !(config.lastScheduledAt instanceof Date && Number.isFinite(config.lastScheduledAt.getTime()))) throw new Error("Last scheduled date is invalid");
  if (config.nextRunAt !== null && !(config.nextRunAt instanceof Date && Number.isFinite(config.nextRunAt.getTime()))) throw new Error("Next run date is invalid");
  return { ...config, endpoint, region, bucket, prefix, accessKey: config.accessKey.trim(), secretKey: config.secretKey.trim() };
};

type BackupStorageRow = {
  id: number;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  enabled: boolean;
  scheduleEnabled: boolean;
  frequency: string;
  scheduleHour: number;
  scheduleWeekday: number;
  retentionDays: number;
  retentionCount: number;
  defaultProfile: string;
  lastScheduledAt: Date | null;
  nextRunAt: Date | null;
};

type BackupStoragePersistenceData = Omit<BackupStorageConfig, "accessKey" | "secretKey"> & {
  accessKey: string;
  secretKey: string;
};

// This narrow type also allows type-checking before `prisma generate` has run for a new schema model.
const backupStorageDelegate = (prisma as unknown as {
  backupStorageConfig: {
    findUnique(args: { where: { id: number } }): Promise<BackupStorageRow | null>;
    upsert(args: {
      where: { id: number };
      create: BackupStoragePersistenceData & { id: number };
      update: BackupStoragePersistenceData;
    }): Promise<BackupStorageRow>;
  };
}).backupStorageConfig;

const fromRow = (row: BackupStorageRow): BackupStorageConfig => ({
  provider: row.provider as "s3",
  endpoint: row.endpoint,
  region: row.region,
  bucket: row.bucket,
  prefix: row.prefix,
  accessKey: decryptField(row.accessKey) ?? "",
  secretKey: decryptField(row.secretKey) ?? "",
  forcePathStyle: row.forcePathStyle,
  enabled: row.enabled,
  scheduleEnabled: row.scheduleEnabled,
  frequency: row.frequency as BackupFrequency,
  scheduleHour: row.scheduleHour,
  scheduleWeekday: row.scheduleWeekday,
  retentionDays: row.retentionDays,
  retentionCount: row.retentionCount,
  defaultProfile: row.defaultProfile as BackupProfile,
  lastScheduledAt: row.lastScheduledAt,
  nextRunAt: row.nextRunAt,
});

const hint = (value: string): string | null => value ? `...${value.slice(-4)}` : null;

const toPublic = (config: BackupStorageConfig): PublicBackupStorageConfig => {
  const { accessKey, secretKey, ...safe } = config;
  return {
    ...safe,
    hasAccessKey: Boolean(accessKey),
    hasSecretKey: Boolean(secretKey),
    accessKeyHint: hint(accessKey),
    secretKeyHint: hint(secretKey),
  };
};

export const getDecryptedBackupStorageConfig = async (): Promise<BackupStorageConfig | null> => {
  const row = await backupStorageDelegate.findUnique({ where: { id: 1 } });
  return row ? validateBackupStorageConfig(fromRow(row)) : null;
};

export const getPublicBackupStorageConfig = async (): Promise<PublicBackupStorageConfig | null> => {
  const config = await getDecryptedBackupStorageConfig();
  return config ? toPublic(config) : null;
};

export const saveBackupStorageConfig = async (input: BackupStorageConfigInput): Promise<PublicBackupStorageConfig> => {
  const existingRow = await backupStorageDelegate.findUnique({ where: { id: 1 } });
  const existing = existingRow ? fromRow(existingRow) : null;
  const accessKey = input.accessKey?.trim() || existing?.accessKey || "";
  const secretKey = input.secretKey?.trim() || existing?.secretKey || "";
  const candidate = validateBackupStorageConfig({
    ...DEFAULTS,
    ...existing,
    ...input,
    provider: input.provider ?? existing?.provider ?? "s3",
    endpoint: input.endpoint ?? existing?.endpoint ?? "",
    region: input.region ?? existing?.region ?? "",
    bucket: input.bucket ?? existing?.bucket ?? "",
    accessKey,
    secretKey,
  });
  const encryptedAccessKey = input.accessKey?.trim() ? encryptField(accessKey) : existingRow?.accessKey ?? encryptField(accessKey);
  const encryptedSecretKey = input.secretKey?.trim() ? encryptField(secretKey) : existingRow?.secretKey ?? encryptField(secretKey);
  if (!encryptedAccessKey || !encryptedSecretKey) throw new Error("Backup credentials are required");
  const data = { ...candidate, accessKey: encryptedAccessKey, secretKey: encryptedSecretKey };
  const row = await backupStorageDelegate.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return toPublic(fromRow(row));
};

const encodePath = (value: string): string => value.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

export const buildBackupObjectUrl = (config: Pick<BackupStorageConfig, "endpoint" | "bucket" | "forcePathStyle">, key: string): URL => {
  if (!key || key.startsWith("/") || key.includes("\0")) throw new Error("Backup object key is invalid");
  const endpoint = new URL(normalizeEndpoint(config.endpoint));
  const path = encodePath(key);
  if (config.forcePathStyle) endpoint.pathname = `/${encodePath(config.bucket)}/${path}`;
  else {
    endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `/${path}`;
  }
  return endpoint;
};

const sha256 = (value: crypto.BinaryLike): string => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key: crypto.BinaryLike, value: string): Buffer => crypto.createHmac("sha256", key).update(value).digest();
const S3_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

const resolvePublicAddress = async (hostname: string): Promise<{ address: string; family: 4 | 6 }> => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Backup endpoint host is not allowed");
  }
  return addresses[0] as { address: string; family: 4 | 6 };
};

const signedRequest = async (config: BackupStorageConfig, method: "PUT" | "GET" | "HEAD" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> => {
  const url = buildBackupObjectUrl(config, key);
  const payloadHash = sha256(body ?? Buffer.alloc(0));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = headerNames.join(";");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${config.secretKey}`, date);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  let dispatcher: Agent | undefined;
  try {
    const approved = await resolvePublicAddress(url.hostname);
    dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: approved.address, family: approved.family }]);
          else callback(null, approved.address, approved.family);
        },
      },
    });
    const response = await undiciFetch(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      console.error(`[backup-storage] method=${method} category=redirect status=${response.status}`);
      await response.body?.cancel();
      throw new Error("redirect rejected");
    }
    if (!response.ok) {
      console.error(`[backup-storage] method=${method} category=rejected status=${response.status}`);
      await response.body?.cancel();
      throw new Error("request rejected");
    }
    const responseBody = method === "GET" ? await response.arrayBuffer() : undefined;
    if (method !== "GET") await response.body?.cancel();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => { responseHeaders[name] = value; });
    return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch (error) {
    if (!(error instanceof Error && (error.message === "redirect rejected" || error.message === "request rejected"))) {
      const category = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "transport";
      console.error(`[backup-storage] method=${method} category=${category}`);
    }
    throw new Error(`Backup storage ${method} request failed`);
  } finally {
    await dispatcher?.close().catch(() => undefined);
  }
};

export const uploadBackupObject = async (config: BackupStorageConfig, key: string, body: Buffer, contentType: string): Promise<void> => {
  await signedRequest(validateBackupStorageConfig(config), "PUT", key, body, contentType);
};

export const headBackupObject = async (config: BackupStorageConfig, key: string): Promise<BackupObjectMetadata> => {
  const response = await signedRequest(validateBackupStorageConfig(config), "HEAD", key);
  const sizeValue = response.headers.get("content-length");
  const dateValue = response.headers.get("last-modified");
  return {
    size: sizeValue !== null && /^\d+$/.test(sizeValue) ? Number(sizeValue) : null,
    etag: response.headers.get("etag"),
    contentType: response.headers.get("content-type"),
    lastModified: dateValue && Number.isFinite(Date.parse(dateValue)) ? new Date(dateValue) : null,
  };
};

export const deleteBackupObject = async (config: BackupStorageConfig, key: string): Promise<void> => {
  await signedRequest(validateBackupStorageConfig(config), "DELETE", key);
};

export const testBackupStorage = async (config: BackupStorageConfig): Promise<void> => {
  const validated = validateBackupStorageConfig(config);
  const key = `${validated.prefix ? `${validated.prefix}/` : ""}.storage-probe-${crypto.randomUUID()}`;
  const probe = crypto.randomBytes(32);
  let uploaded = false;
  try {
    await uploadBackupObject(validated, key, probe, "application/octet-stream");
    uploaded = true;
    const response = await signedRequest(validated, "GET", key);
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (downloaded.length !== probe.length || !crypto.timingSafeEqual(downloaded, probe)) throw new Error("Backup storage probe verification failed");
    await headBackupObject(validated, key);
  } finally {
    if (uploaded) await deleteBackupObject(validated, key);
  }
};
