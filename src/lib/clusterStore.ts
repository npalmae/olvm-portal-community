import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type NetworkConfig = { name: string; prefix: string; mask: string };

export type ClusterConnection = {
  id: string;
  name: string;
  engineId: string;
  tag?: string;
  storageDomains?: string[];
  networks?: string[];
  networkConfig?: NetworkConfig[];
  createdAt: string;
};

export type ClusterInput = Partial<Omit<ClusterConnection, "createdAt">> & {
  name?: string;
  engineId?: string;
};

type TenantRow = Awaited<ReturnType<typeof prisma.tenant.findFirst>>;

const toCluster = (row: NonNullable<TenantRow>): ClusterConnection => ({
  id: row.id,
  name: row.name,
  engineId: row.engineId,
  tag: row.tag ?? undefined,
  storageDomains: row.storageDomains.length ? row.storageDomains : undefined,
  networks: row.networks.length ? row.networks : undefined,
  networkConfig: Array.isArray(row.networkConfig) ? row.networkConfig as NetworkConfig[] : undefined,
  createdAt: row.createdAt.toISOString(),
});

const validate = (input: ClusterInput) => {
  if (!input.name?.trim()) throw new Error("El nombre es obligatorio");
  if (!input.engineId?.trim()) throw new Error("Debe seleccionar un engine");
  if (!input.tag?.trim()) throw new Error("El tag multitenant es obligatorio");
};

const assertUniqueTag = async (engineId: string, tag: string, excludedId?: string) => {
  const tenants = await prisma.tenant.findMany({ where: { engineId } });
  const normalized = tag.trim().toLowerCase();
  const duplicate = tenants.find((tenant) => tenant.id !== excludedId && tenant.tag?.trim().toLowerCase() === normalized);
  if (duplicate) throw new Error(`El tag "${tag}" ya esta asignado al tenant ${duplicate.id}`);
};

export const listClusters = async (): Promise<ClusterConnection[]> =>
  (await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } })).map(toCluster);

export const getClusterById = async (id: string): Promise<ClusterConnection | null> => {
  const row = await prisma.tenant.findUnique({ where: { id } });
  return row ? toCluster(row) : null;
};

export const createCluster = async (input: ClusterInput): Promise<ClusterConnection> => {
  validate(input);
  const id = input.id?.trim() || `tenant-${Date.now()}`;
  if (await prisma.tenant.findUnique({ where: { id } })) throw new Error(`Ya existe un tenant con id "${id}"`);
  await assertUniqueTag(input.engineId!.trim(), input.tag!.trim());
  const row = await prisma.tenant.create({ data: {
    id, name: input.name!.trim(), engineId: input.engineId!.trim(), tag: input.tag!.trim(),
    storageDomains: input.storageDomains?.filter(Boolean) ?? [], networks: input.networks?.filter(Boolean) ?? [],
    networkConfig: input.networkConfig?.length ? input.networkConfig : Prisma.JsonNull,
  } });
  return toCluster(row);
};

export const updateCluster = async (id: string, input: ClusterInput): Promise<ClusterConnection> => {
  const current = await getClusterById(id);
  if (!current) throw new Error("Tenant no encontrado");
  const next = { ...current, ...input };
  validate(next);
  await assertUniqueTag(next.engineId, next.tag!, id);
  const row = await prisma.tenant.update({ where: { id }, data: {
    name: next.name.trim(), engineId: next.engineId.trim(), tag: next.tag?.trim() || null,
    storageDomains: next.storageDomains?.filter(Boolean) ?? [], networks: next.networks?.filter(Boolean) ?? [],
    networkConfig: next.networkConfig?.length ? next.networkConfig : Prisma.JsonNull,
  } });
  return toCluster(row);
};

export const deleteCluster = async (id: string): Promise<void> => {
  await prisma.tenant.delete({ where: { id } });
};
