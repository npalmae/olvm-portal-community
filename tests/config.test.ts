import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const originalEnv = { ...process.env };

const loadConfig = async () => {
  vi.resetModules();
  return import("../src/lib/config");
};

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("config", () => {
  it("loads single-tenant fallback variables and sanitizes baseUrl", async () => {
    process.env = {
      ...originalEnv,
      OLVM_BASE_URL: "https://example.com/api/",
      OLVM_USERNAME: "user",
      OLVM_PASSWORD: "pass",
    };

    const { getTenants, resolveTenant } = await loadConfig();
    const tenants = getTenants();

    expect(tenants).toHaveLength(1);
    expect(tenants[0].baseUrl).toBe("https://example.com/api");
    expect(resolveTenant().id).toBe("default");
  });

  it("parses OLVM_TENANTS and loads CA file", async () => {
    const caPath = path.join(process.cwd(), "certs", "test-ca.pem");
    fs.writeFileSync(caPath, "FAKE-CA");

    process.env = {
      ...originalEnv,
      OLVM_TENANTS: JSON.stringify([
        {
          id: "qa",
          name: "QA",
          baseUrl: "https://qa.example/api/",
          username: "qa-user",
          password: "qa-pass",
          allowInsecure: true,
          caFile: caPath,
        },
      ]),
    };

    const { getTenants, resolveTenant } = await loadConfig();
    const tenants = getTenants();

    expect(tenants).toHaveLength(1);
    expect(tenants[0].allowInsecure).toBe(true);
    expect(tenants[0].caCert?.toString()).toBe("FAKE-CA");
    expect(resolveTenant("qa").name).toBe("QA");

    fs.unlinkSync(caPath);
  });

  it("requires tenant id when multiple tenants exist", async () => {
    process.env = {
      ...originalEnv,
      OLVM_TENANTS: JSON.stringify([
        {
          id: "a",
          name: "Tenant A",
          baseUrl: "https://a.example/api",
          username: "user",
          password: "pass",
        },
        {
          id: "b",
          name: "Tenant B",
          baseUrl: "https://b.example/api",
          username: "user",
          password: "pass",
        },
      ]),
    };

    const { resolveTenant } = await loadConfig();
    expect(() => resolveTenant()).toThrow(/Tenant id is required/i);
  });
});
