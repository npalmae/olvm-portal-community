import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptField,
  encryptField,
  getFieldEncryptionKey,
  hashShortLivedSecret,
  hashToken,
  isEncrypted,
  safeEqualHash,
} from "./crypto";

describe("field crypto", () => {
  const original = process.env.FIELD_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
    else process.env.FIELD_ENCRYPTION_KEY = original;
  });

  it("round trips AES-256-GCM values with randomized envelopes", () => {
    const first = encryptField("secret")!;
    const second = encryptField("secret")!;
    expect(first).not.toBe(second);
    expect(isEncrypted(first)).toBe(true);
    expect(decryptField(first)).toBe("secret");
    expect(encryptField(first)).toBe(first);
  });

  it("rejects malformed keys and tampered ciphertext", () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(31).toString("base64");
    expect(() => getFieldEncryptionKey()).toThrow(/32 bytes/);
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptField("secret")!;
    expect(() => decryptField(`${encrypted.slice(0, -2)}AA`)).toThrow();
  });

  it("creates deterministic one-way hashes and compares them safely", () => {
    expect(hashToken("token")).not.toContain("token");
    expect(safeEqualHash(hashToken("token"), hashToken("token"))).toBe(true);
    expect(safeEqualHash(hashToken("token"), hashToken("other"))).toBe(false);
    expect(hashShortLivedSecret("123456")).toBe(hashShortLivedSecret("123456"));
  });
});
