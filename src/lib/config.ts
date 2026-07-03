import {
  listClusters,
  type ClusterConnection,
} from "@/lib/clusterStore";

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
};

const toTenant = (cluster: ClusterConnection): TenantConfig => ({
  id: cluster.id,
  name: cluster.name,
  baseUrl: cluster.baseUrl,
  username: cluster.username,
  password: cluster.password,
  token: cluster.token,
  allowInsecure: cluster.allowInsecure,
  tag: cluster.tag,
  caCert: cluster.caCert ? Buffer.from(cluster.caCert) : undefined,
});

export const getTenants = (): TenantConfig[] =>
  listClusters().map(toTenant);

export const resolveTenant = (tenantId?: string): TenantConfig => {
  const sanitized =
    tenantId && tenantId !== "undefined" ? tenantId.trim() : undefined;

  if (sanitized) {
    const tenant = getTenants().find((t) => t.id === sanitized);
    if (!tenant) {
      throw new Error(`Tenant ${sanitized} not found. Check clusters config`);
    }
    return tenant;
  }

  const tenants = getTenants();
  if (tenants.length === 1) {
    return tenants[0];
  }

  throw new Error("Tenant id is required when multiple tenants are configured");
};

export const getTenantById = (tenantId: string) => resolveTenant(tenantId);
