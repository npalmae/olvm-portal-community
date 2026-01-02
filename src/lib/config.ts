import fs from "fs";
import path from "path";

export type TenantConfig = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  allowInsecure?: boolean;
  token?: string;
  caFile?: string;
  caCert?: Buffer;
};

const sanitizeBaseUrl = (baseUrl: string) => {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const loadCa = (filePath?: string) => {
  if (!filePath) return undefined;
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(
      `Cannot read CA file at ${resolved}: ${(error as Error).message}`,
    );
  }
};

const parseTenantsFromEnv = (): TenantConfig[] => {
  if (process.env.OLVM_TENANTS) {
    const raw = process.env.OLVM_TENANTS;
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Tolerate bash-exported values without JSON quotes (e.g. [{id:foo,...}])
      try {
        parsed = Function(`"use strict"; return (${raw});`)();
      } catch {
        throw new Error("OLVM_TENANTS is not valid JSON");
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error("OLVM_TENANTS must be an array");
    }

    return (parsed as TenantConfig[]).map((tenant) => ({
      ...tenant,
      baseUrl: sanitizeBaseUrl(tenant.baseUrl),
      caCert: loadCa(tenant.caFile),
    }));
  }

  const baseUrl = process.env.OLVM_BASE_URL;
  const username = process.env.OLVM_USERNAME;
  const password = process.env.OLVM_PASSWORD;

  if (baseUrl && username && password) {
    return [
      {
        id: "default",
        name: "Default",
        baseUrl: sanitizeBaseUrl(baseUrl),
        username,
        password,
        allowInsecure: process.env.OLVM_ALLOW_INSECURE === "true",
        token: process.env.OLVM_TOKEN,
        caFile: process.env.OLVM_CA_FILE,
        caCert: loadCa(process.env.OLVM_CA_FILE),
      },
    ];
  }

  return [];
};

const tenantsCache = parseTenantsFromEnv();

export const getTenants = () => tenantsCache;

export const resolveTenant = (tenantId?: string): TenantConfig => {
  const sanitized =
    tenantId && tenantId !== "undefined" ? tenantId.trim() : undefined;

  if (sanitized) {
    const tenant = tenantsCache.find((t) => t.id === sanitized);
    if (!tenant) {
      throw new Error(`Tenant ${sanitized} not found. Check OLVM_TENANTS`);
    }
    return tenant;
  }

  if (tenantsCache.length === 1) {
    return tenantsCache[0];
  }

  throw new Error("Tenant id is required when multiple tenants are configured");
};

export const getTenantById = (tenantId: string) => resolveTenant(tenantId);
