/**
 * engineClient — dispatcher de engine por tenant.
 *
 * Cada tenant resuelve a un engine (vCenter u OLVM) y este modulo expone la
 * superficie comun para que rutas/UI sea agnostica del hypervisor:
 *
 *   import { fetchVms, startVm } from "@/lib/engineClient";
 *
 * Migracion de rutas: reemplazar imports de "@/lib/olvmClient" por
 * "@/lib/engineClient" (sustitucion mecanica, sin cambios de logica).
 */

import * as olvm from "./olvmClient";
import * as vmware from "./vmwareClient";
import { getTenantById } from "./config";
import type { TenantConfig } from "./config";

export type EngineType = "olvm" | "vmware";

export const engineTypeForTenant = async (tenantId: string): Promise<EngineType> => {
  const tenant = await getTenantById(tenantId);
  return tenant.engineType ?? "olvm";
};

type EngineModule = {
  fetchVms: typeof olvm.fetchVms;
  fetchVmById: typeof olvm.fetchVmById;
  sendVmAction: typeof olvm.sendVmAction;
  deleteVm: typeof olvm.deleteVm;
  cloneVm: typeof olvm.cloneVm;
  createVm: typeof olvm.createVm;
  updateVmResources: typeof olvm.updateVmResources;
  enforceVmTagPolicy: typeof olvm.enforceVmTagPolicy;
  fetchVmConsoleInfo: typeof olvm.fetchVmConsoleInfo;
  fetchClusters: typeof olvm.fetchClusters;
  fetchHosts: typeof olvm.fetchHosts;
  fetchStorageDomains: typeof olvm.fetchStorageDomains;
  fetchNetworks: typeof olvm.fetchNetworks;
  fetchVnicProfiles: typeof olvm.fetchVnicProfiles;
  fetchTemplates: typeof olvm.fetchTemplates;
  isSupportedAction: (action: string) => boolean;
  assignTagToVm: (tenantId: string, vmId: string) => Promise<void>;
  removeTagFromVm: (tenantId: string, vmId: string) => Promise<void>;
  fetchVmNics: typeof olvm.fetchVmNics;
  addNicToVm: typeof olvm.addNicToVm;
  updateNicLink: typeof olvm.updateNicLink;
  deleteNicFromVm: typeof olvm.deleteNicFromVm;
};

/** El modulo VMware implementa (sub)conjunto compatible; lo tipamos como olvm
 *  para compartir la superficie y detectar desviaciones en compilacion. */
const modules: Record<EngineType, EngineModule> = {
  olvm: olvm as unknown as EngineModule,
  vmware: vmware as unknown as EngineModule,
};

export const engineFor = (type: EngineType): EngineModule => modules[type];

/* ── Test de conexión con dispatch por tipo de engine ─────────────────── */

type TestConnectionInput = {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  caCert?: Buffer | string;
};

export const testEngineConnection = (type: EngineType, input: TestConnectionInput) =>
  type === "vmware" ? vmware.testConnection(input) : olvm.testConnection(input);

/* ── Re-exports tipados (superficie comun) ─────────────────────────────── */

export type { VmSummary, ConsoleInfo, VmMetric } from "./olvmClient";
export type { TenantConfig };
export { invalidateDispatcherCache } from "./olvmClient";

/* ── Operaciones con dispatch automatico por tenant ───────────────────── */

export const fetchVms = (tenantId: string) => engineForTenant(tenantId).then((m) => m.fetchVms(tenantId));
export const fetchVmById = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchVmById(tenantId, vmId));
export const sendVmAction = (tenantId: string, vmId: string, action: string) =>
  engineForTenant(tenantId).then((m) => m.sendVmAction(tenantId, vmId, action));
export const deleteVm = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.deleteVm(tenantId, vmId));
export const enforceVmTagPolicy = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.enforceVmTagPolicy(tenantId, vmId));
export const fetchClusters = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchClusters(tenantId));
export const fetchHosts = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchHosts(tenantId));
export const fetchStorageDomains = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchStorageDomains(tenantId));
export const fetchNetworks = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchNetworks(tenantId));
export const fetchVnicProfiles = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchVnicProfiles(tenantId));
export const fetchTemplates = (tenantId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchTemplates(tenantId));
export const fetchVmConsoleInfo = (
  tenantId: string,
  vmId: string,
  protocol?: "spice" | "vnc",
  opts?: Parameters<typeof olvm.fetchVmConsoleInfo>[3],
) => engineForTenant(tenantId).then((m) => m.fetchVmConsoleInfo(tenantId, vmId, protocol, opts));
export const createVm = (tenantId: string, input: Parameters<typeof olvm.createVm>[1]) =>
  engineForTenant(tenantId).then((m) => m.createVm(tenantId, input));
export const importOvaVm = (
  tenantId: string,
  payload: Parameters<typeof olvm.importOvaVm>[1] & Parameters<typeof vmware.importOvaVm>[1],
): Promise<{ vmId: string; pending: boolean }> => {
  const engine = engineTypeForTenant(tenantId).then(async (type) => {
    if (type === "vmware") {
      return vmware.importOvaVm(tenantId, payload as Parameters<typeof vmware.importOvaVm>[1]);
    }
    return olvm.importOvaVm(tenantId, payload as Parameters<typeof olvm.importOvaVm>[1]);
  });
  return engine;
};
export const cloneVm = (
  tenantId: string,
  sourceVmId: string,
  cloneName: string,
  onProgress?: Parameters<typeof olvm.cloneVm>[3],
) => engineForTenant(tenantId).then((m) => m.cloneVm(tenantId, sourceVmId, cloneName, onProgress));
export const updateVmResources = (
  tenantId: string,
  vmId: string,
  payload: Parameters<typeof olvm.updateVmResources>[2],
) => engineForTenant(tenantId).then((m) => m.updateVmResources(tenantId, vmId, payload));
export const isSupportedAction = (tenantId: string, action: string) =>
  engineForTenant(tenantId).then((m) => m.isSupportedAction(action));
export const assignTagToVm = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.assignTagToVm(tenantId, vmId));
export const removeTagFromVm = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.removeTagFromVm(tenantId, vmId));
export const fetchVmNics = (tenantId: string, vmId: string) =>
  engineForTenant(tenantId).then((m) => m.fetchVmNics(tenantId, vmId));
export const addNicToVm = (
  tenantId: string,
  vmId: string,
  params: Parameters<typeof olvm.addNicToVm>[2],
) => engineForTenant(tenantId).then((m) => m.addNicToVm(tenantId, vmId, params));
export const updateNicLink = (
  tenantId: string,
  vmId: string,
  nicId: string,
  linked: boolean,
) => engineForTenant(tenantId).then((m) => m.updateNicLink(tenantId, vmId, nicId, linked));
export const deleteNicFromVm = (tenantId: string, vmId: string, nicId: string) =>
  engineForTenant(tenantId).then((m) => m.deleteNicFromVm(tenantId, vmId, nicId));

const engineForTenant = async (tenantId: string): Promise<EngineModule> => {
  const type = await engineTypeForTenant(tenantId);
  return modules[type];
};

/* ── Tipos de conveniencia re-exportados del cliente vmware ───────────── */
export { TENANT_CATEGORY as VMWARE_TENANT_CATEGORY } from "./vmwareClient";
