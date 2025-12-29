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
    try {
      const parsed = JSON.parse(process.env.OLVM_TENANTS) as TenantConfig[];
      return parsed.map((tenant) => ({
        ...tenant,
        baseUrl: sanitizeBaseUrl(tenant.baseUrl),
        caCert: loadCa(tenant.caFile),
      }));
    } catch {
      throw new Error("OLVM_TENANTS is not valid JSON");
    }
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

export const getTenantById = (tenantId: string) => {
  const tenant = tenantsCache.find((t) => t.id === tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found. Check OLVM_TENANTS`);
  }
  return tenant;
};
