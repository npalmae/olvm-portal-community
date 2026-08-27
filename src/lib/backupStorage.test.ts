import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));
const network = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  agentOptions: undefined as unknown,
}));

vi.mock("./prisma", () => ({ prisma: { backupStorageConfig: storage } }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) { network.agentOptions = options; }
    close = network.close;
  },
  fetch: network.fetch,
}));

import { encryptField } from "./crypto";
import {
  BackupStorageConfig,
  buildBackupObjectUrl,
  getPublicBackupStorageConfig,
  isPublicIpAddress,
  saveBackupStorageConfig,
  uploadBackupObject,
  validateBackupStorageConfig,
} from "./backupStorage";

const validConfig = (): BackupStorageConfig => ({
  provider: "s3",
  endpoint: "https://s3.us-central-1.wasabisys.com",
  region: "us-central-1",
  bucket: "portal-backups",
  prefix: "backups/portal",
  accessKey: "ACCESS12345678",
  secretKey: "SECRET12345678",
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
});

const row = (config = validConfig()) => ({
  id: 1,
  ...config,
  accessKey: encryptField(config.accessKey)!,
  secretKey: encryptField(config.secretKey)!,
  updatedAt: new Date(),
});

beforeEach(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  storage.findUnique.mockReset();
  storage.upsert.mockReset();
  network.lookup.mockReset();
  network.fetch.mockReset();
  network.close.mockClear();
  network.agentOptions = undefined;
});

describe("backup endpoint network safety", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
    "::", "::1", "::ffff:127.0.0.1", "2001:db8::1", "fc00::1", "fe80::1", "ff02::1",
  ])("classifies non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "192.0.0.9", "2606:4700:4700::1111"])("classifies public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it("rejects a hostname if any DNS answer is non-public without making an S3 request", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(uploadBackupObject(validConfig(), "test.bin", Buffer.from("test"), "application/octet-stream"))
      .rejects.toThrow("Backup storage PUT request failed");
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("pins a public DNS answer and disables redirects with a two-minute timeout", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.fetch.mockResolvedValue(new Response(null, { status: 200 }));

    await uploadBackupObject(validConfig(), "test.bin", Buffer.from("test"), "application/octet-stream");

    expect(network.lookup).toHaveBeenCalledWith("s3.us-central-1.wasabisys.com", { all: true, verbatim: true });
    expect(network.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: "PUT",
      redirect: "manual",
      signal: timeoutSignal,
      dispatcher: expect.anything(),
    }));
    expect(timeout).toHaveBeenCalledWith(120_000);
    const options = network.agentOptions as { connect: { lookup: (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void } };
    const callback = vi.fn();
    options.connect.lookup("s3.us-central-1.wasabisys.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    const allCallback = vi.fn();
    options.connect.lookup("s3.us-central-1.wasabisys.com", { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    timeout.mockRestore();
  });
});

describe("backup storage validation", () => {
  it.each([
    "http://s3.example.com",
    "https://user:pass@s3.example.com",
    "https://s3.example.com/path",
    "https://s3.example.com?token=secret",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.2.3.4",
    "https://169.254.20.1",
    "https://[::1]",
    "https://[fd00::1]",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => validateBackupStorageConfig({ ...validConfig(), endpoint })).toThrow();
  });

  it("normalizes safe values", () => {
    const config = validateBackupStorageConfig({ ...validConfig(), endpoint: " https://s3.example.com/ ", prefix: "/backups/daily/" });
    expect(config.endpoint).toBe("https://s3.example.com");
    expect(config.prefix).toBe("backups/daily");
  });

  it("rejects invalid enums, names, and numeric bounds", () => {
    expect(() => validateBackupStorageConfig({ ...validConfig(), frequency: "hourly" as never })).toThrow("frequency");
    expect(() => validateBackupStorageConfig({ ...validConfig(), defaultProfile: "tiny" as never })).toThrow("profile");
    expect(() => validateBackupStorageConfig({ ...validConfig(), bucket: "Bad_Bucket" })).toThrow("bucket");
    expect(() => validateBackupStorageConfig({ ...validConfig(), prefix: "backups/../secret" })).toThrow("prefix");
    expect(() => validateBackupStorageConfig({ ...validConfig(), scheduleHour: 24 })).toThrow("Schedule hour");
    expect(() => validateBackupStorageConfig({ ...validConfig(), scheduleWeekday: -1 })).toThrow("Schedule weekday");
    expect(() => validateBackupStorageConfig({ ...validConfig(), retentionDays: 0 })).toThrow("Retention days");
    expect(() => validateBackupStorageConfig({ ...validConfig(), retentionCount: 1001 })).toThrow("Retention count");
  });
});

describe("backup object URLs", () => {
  it("builds path-style and virtual-host URLs with encoded keys", () => {
    const config = validConfig();
    expect(buildBackupObjectUrl(config, "daily/a file.tar.gz").toString()).toBe("https://s3.us-central-1.wasabisys.com/portal-backups/daily/a%20file.tar.gz");
    expect(buildBackupObjectUrl({ ...config, forcePathStyle: false }, "daily/a file.tar.gz").toString()).toBe("https://portal-backups.s3.us-central-1.wasabisys.com/daily/a%20file.tar.gz");
  });
});

describe("stored credentials", () => {
  it("returns only presence flags and short hints publicly", async () => {
    storage.findUnique.mockResolvedValue(row());
    const result = await getPublicBackupStorageConfig();
    expect(result).toMatchObject({ hasAccessKey: true, hasSecretKey: true, accessKeyHint: "...5678", secretKeyHint: "...5678" });
    expect(result).not.toHaveProperty("accessKey");
    expect(result).not.toHaveProperty("secretKey");
    expect(JSON.stringify(result)).not.toContain("ACCESS12345678");
    expect(JSON.stringify(result)).not.toContain("SECRET12345678");
  });

  it("preserves encrypted credentials when blank values are saved", async () => {
    const existing = row();
    storage.findUnique.mockResolvedValue(existing);
    storage.upsert.mockImplementation(async ({ update }) => ({ ...existing, ...update }));
    await saveBackupStorageConfig({ accessKey: "  ", secretKey: "", retentionDays: 60 });
    const update = storage.upsert.mock.calls[0][0].update;
    expect(update.accessKey).toBe(existing.accessKey);
    expect(update.secretKey).toBe(existing.secretKey);
    expect(update.retentionDays).toBe(60);
  });
});
