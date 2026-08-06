import {
  listClusters,
  type ClusterConnection,
} from "@/lib/clusterStore";
import { getEngineById } from "@/lib/engineStore";

export type TenantConfig = {
  id: string;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecure?: boolean;
  token?: string;
  caFile?: string;
  caCert?: Buffer;
  tag?: string;
  storageDomains?: string[];
  networks?: string[];
  networkConfig?: { name: string; prefix: string; mask: string }[];
  sharedStorageDomains?: string[];
  brandName?: string;
  brandLogoUrl?: string;
  engineId: string;
};

const toTenant = async (cluster: ClusterConnection): Promise<TenantConfig> => {
  const engine = await getEngineById(cluster.engineId);
  if (!engine) {
    throw new Error(
      `Engine "${cluster.engineId}" no encontrado para tenant "${cluster.id}". Configura un engine en /admin/clusters`,
    );
  }
  return {
    id: cluster.id,
    name: cluster.name,
    engineId: engine.id,
    baseUrl: engine.baseUrl,
    username: engine.username,
    password: engine.password,
    token: engine.token,
    allowInsecure: engine.allowInsecure,
    tag: cluster.tag,
    storageDomains: cluster.storageDomains,
    networks: cluster.networks,
    networkConfig: cluster.networkConfig,
    sharedStorageDomains: engine.sharedStorageDomains,
    brandName: engine.brandName,
    brandLogoUrl: engine.brandLogoUrl,
    caCert: engine.caCert ? Buffer.from(engine.caCert) : undefined,
  };
};

export const getTenants = async (): Promise<TenantConfig[]> =>
  (await Promise.all((await listClusters()).map(async (c) => {
    try {
      return await toTenant(c);
    } catch {
      return null;
    }
  }))).filter((t): t is TenantConfig => t !== null);

export const resolveTenant = async (tenantId?: string): Promise<TenantConfig> => {
  const sanitized =
    tenantId && tenantId !== "undefined" ? tenantId.trim() : undefined;

  if (sanitized) {
    const tenant = (await getTenants()).find((t) => t.id === sanitized);
    if (!tenant) {
      throw new Error(`Tenant ${sanitized} not found. Check clusters config`);
    }
    return tenant;
  }

  const tenants = await getTenants();
  if (tenants.length === 1) {
    return tenants[0];
  }

  throw new Error("Tenant id is required when multiple tenants are configured");
};

export const getTenantById = (tenantId: string) => resolveTenant(tenantId);
