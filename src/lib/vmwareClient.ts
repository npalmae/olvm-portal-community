/**
 * vmwareClient — cliente VMware vSphere (vCenter REST API 7.x/8.x)
 *
 * Mantiene la misma superficie de exports que olvmClient.ts para que las
 * rutas/API/UI migren con cambios minimos (ver src/lib/engineClient.ts).
 *
 * Modelo de tenancy:
 *   - Cada tenant del portal mapea a UN tag de vSphere dentro de la categoria
 *     dedicada TENANT_CATEGORY. El aislamiento lo enforce el portal
 *     (enforceVmTagPolicy) exactamente igual que en OLVM.
 *
 * Autenticacion vCenter:
 *   - POST /api/session con Basic -> vmware-api-session-id (token de sesion)
 *   - Sesiones cacheadas por engine; re-login automatico on 401.
 *
 * Convenciones:
 *   - viFetch(): REST "puro" (/api/...)
 *   - vapi(): servicios JSON-RPC de vAPI (/rest/com/vmware/...) para clone,
 *     hardware, cdrom y otras operaciones sin endpoint REST directo.
 */

import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { getTenantById, type TenantConfig } from "./config";

/* ────────────────────────────────────────────────────────────────────────────
 * Tipos publicos (paridad con olvmClient)
 * ──────────────────────────────────────────────────────────────────────── */

export type VmMetric = {
  cpuPercent?: number;
  memoryPercent?: number;
  diskReadBytes?: number;
  diskWriteBytes?: number;
  networkBytes?: number;
};

export type VmSummary = {
  id: string;
  name: string;
  status: string; // "up" | "down" | "suspended" | "unknown" (normalizado al vocabulario del portal)
  cluster?: string;
  template?: string;
  memoryMB?: number;
  cpuCores?: number;
  sockets?: number;
  host?: string;
  os?: string;
  ip?: string;
  tags?: string[];
  metrics?: VmMetric;
};

export type ConsoleInfo = {
  protocol: string; // "webmks"
  host?: string;
  port?: number | string;
  tlsPort?: number | string;
  consoleId?: string;
  ticket?: string;
  websocket?: { wsUrl?: string; wsPath?: string; engineHost?: string };
  proxyTicket?: { value: string; host?: string; port?: number; sslTarget?: boolean };
};

export type OlvmHost = { id: string; name: string; address?: string };

export type StorageDomainInfo = {
  id: string;
  name: string;
  type: string; // datastore type
  status?: string;
  availableGB: number;
  usedGB: number;
  totalGB: number;
};

export type OlvmCluster = { id: string; name: string };
export type OlvmTemplate = { id: string; name: string };
export type OlvmNetwork = { id: string; name: string };
export type VnicProfile = { id: string; name: string; networkId?: string };

/* ────────────────────────────────────────────────────────────────────────────
 * Constantes de tenancy
 * ──────────────────────────────────────────────────────────────────────── */

/** Categoria dedicada de vSphere para los tags de tenant del portal. */
export const TENANT_CATEGORY = "virtual-portal-tenant";

/* ────────────────────────────────────────────────────────────────────────────
 * HTTP core (undici, mismo patron TLS que olvmClient)
 * ──────────────────────────────────────────────────────────────────────── */

const dispatcherCache = new Map<string, UndiciAgent>();

export const invalidateDispatcherCache = (tenantId?: string) => {
  if (tenantId) dispatcherCache.delete(tenantId);
  else dispatcherCache.clear();
  if (tenantId) sessionCache.delete(tenantId);
  else sessionCache.clear();
};

const getDispatcher = (tenant: TenantConfig) => {
  if (dispatcherCache.has(tenant.id)) return dispatcherCache.get(tenant.id);
  const dispatcher = new UndiciAgent({
    connect: tenant.allowInsecure
      ? { rejectUnauthorized: false }
      : tenant.caCert
        ? { ca: tenant.caCert.toString() }
        : undefined,
  });
  dispatcherCache.set(tenant.id, dispatcher);
  return dispatcher;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Sesion vCenter
 * ──────────────────────────────────────────────────────────────────────── */

const sessionCache = new Map<string, { token: string; createdAt: number }>();
const SESSION_TTL_MS = 25 * 60 * 1000; // vCenter expira ~30 min; renovamos a los 25.

const login = async (tenant: TenantConfig): Promise<string> => {
  if (!tenant.username || !tenant.password) {
    throw new Error("Engine VMware sin credenciales (usuario/password requeridos)");
  }
  const basic = Buffer.from(`${tenant.username}:${tenant.password}`).toString("base64");
  const res = await undiciFetch(`${tenant.baseUrl}/api/session`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
    dispatcher: getDispatcher(tenant) as never,
  });
  if (!res.ok) throw new Error(`vCenter login ${res.status}: ${await res.text()}`);
  const token = (await res.json()) as string;
  sessionCache.set(tenant.id, { token, createdAt: Date.now() });
  return token;
};

const getSessionToken = async (tenant: TenantConfig, forceNew = false): Promise<string> => {
  const cached = sessionCache.get(tenant.id);
  if (!forceNew && cached && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached.token;
  return login(tenant);
};

type ViFetchInit = RequestInit & { raw?: boolean };

/** REST puro contra /api/... con re-login automatico on 401. */
const viFetch = async <T = unknown>(
  tenant: TenantConfig,
  path: string,
  init: ViFetchInit = {},
  _retry = true,
): Promise<T> => {
  const { raw, ...requestInit } = init;
  const token = await getSessionToken(tenant);
  const res = await undiciFetch(`${tenant.baseUrl}${path}`, {
    method: requestInit.method,
    body: requestInit.body as string | undefined,
    headers: {
      "Content-Type": "application/json",
      "vmware-api-session-id": token,
      ...(init.headers as Record<string, string> | undefined),
    },
    dispatcher: getDispatcher(tenant) as never,
  });
  if (res.status === 401 && _retry) {
    await getSessionToken(tenant, true);
    return viFetch<T>(tenant, path, init, false);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`vCenter ${res.status} ${path}: ${text.slice(0, 300)}`);
  if (!text) return undefined as T;
  return (raw ? text : (JSON.parse(text) as T)) as T;
};

/** Servicio vAPI (JSON-RPC historic /rest/com/vmware/...). */
const vapi = async <T = unknown>(
  tenant: TenantConfig,
  service: string, // ej. "vcenter.vm.hardware.cpu"
  action: string, // ej. "update"
  payload?: unknown,
  _retry = true,
): Promise<T> => {
  const token = await getSessionToken(tenant);
  const url = `${tenant.baseUrl}/rest/com/vmware/${service.replaceAll(".", "/")}?~action=${action}`;
  const res = await undiciFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "vmware-api-session-id": token,
    },
    body: JSON.stringify(payload ?? {}),
    dispatcher: getDispatcher(tenant) as never,
  });
  if (res.status === 401 && _retry) {
    await getSessionToken(tenant, true);
    return vapi<T>(tenant, service, action, payload, false);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`vAPI ${res.status} ${service}.${action}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text).value as T) : (undefined as T);
};

const GB = 1024 * 1024 * 1024;
const bytesToGB = (bytes: number) => Math.round((bytes / GB) * 10) / 10;

/* ────────────────────────────────────────────────────────────────────────────
 * Tagging (cis/tagging) — base del multi-tenant
 * ──────────────────────────────────────────────────────────────────────── */

type TaggingCategory = { id: string; name: string; cardinality: string };
type TaggingTag = { id: string; name: string; category_id: string };
type TaggableObject = { id: string; type: string };

const ensureCategory = async (tenant: TenantConfig): Promise<TaggingCategory> => {
  const categories = await viFetch<TaggingCategory[]>(tenant, "/api/cis/tagging/categories");
  const found = categories.find((c) => c.name === TENANT_CATEGORY);
  if (found) return found;
  return viFetch<TaggingCategory>(tenant, "/api/cis/tagging/categories", {
    method: "POST",
    body: JSON.stringify({
      create_spec: {
        name: TENANT_CATEGORY,
        description: "Tenant tags managed by VIRTUAL-PORTAL",
        cardinality: "MULTIPLE",
        associable_types: ["VirtualMachine"],
      },
    }),
  });
};

const listTags = (tenant: TenantConfig) =>
  viFetch<TaggingTag[]>(tenant, "/api/cis/tagging/tags");

const ensureTenantTag = async (tenant: TenantConfig, tagName: string): Promise<TaggingTag> => {
  const category = await ensureCategory(tenant);
  const tags = await listTags(tenant);
  const found = tags.find((t) => t.name === tagName && t.category_id === category.id);
  if (found) return found;
  return viFetch<TaggingTag>(tenant, "/api/cis/tagging/tags", {
    method: "POST",
    body: JSON.stringify({
      create_spec: { name: tagName, description: `Tenant ${tagName}`, category_id: category.id },
    }),
  });
};

const attachTag = (tenant: TenantConfig, tagId: string, objectId: string, objectType = "VirtualMachine") =>
  viFetch(tenant, "/api/cis/tagging/tag-association?~action=attach", {
    method: "POST",
    body: JSON.stringify({
      tag_id: tagId,
      object_id: { id: objectId, type: objectType },
    }),
  });

const detachTag = (tenant: TenantConfig, tagId: string, objectId: string, objectType = "VirtualMachine") =>
  viFetch(tenant, "/api/cis/tagging/tag-association?~action=detach", {
    method: "POST",
    body: JSON.stringify({
      tag_id: tagId,
      object_id: { id: objectId, type: objectType },
    }),
  });

const listAttachedObjects = async (tenant: TenantConfig, tagId: string): Promise<TaggableObject[]> => {
  const res = await viFetch<{ associated_objects?: TaggableObject[] }>(
    tenant,
    "/api/cis/tagging/tag-association?~action=list-attached-objects",
    { method: "POST", body: JSON.stringify({ tag_id: tagId }) },
  );
  return res.associated_objects ?? [];
};

const listVmTagIds = async (tenant: TenantConfig, vmId: string): Promise<string[]> => {
  const res = await viFetch<{ tag_ids?: string[] }>(
    tenant,
    "/api/cis/tagging/tag-association?~action=list-attached-tags",
    { method: "POST", body: JSON.stringify({ object_id: { id: vmId, type: "VirtualMachine" } }) },
  );
  return res.tag_ids ?? [];
};

/** Tag esperado del tenant (fail-closed: sin tag configurado, nada pasa). */
const expectedTenantTagName = (tenant: TenantConfig) => tenant.tag?.trim();

/** Aplica el tag del tenant a una VM (crea categoria/tag si no existen). */
export const applyTenantTag = async (tenant: TenantConfig, vmId: string) => {
  const tagName = expectedTenantTagName(tenant);
  if (!tagName) return;
  const tag = await ensureTenantTag(tenant, tagName);
  await attachTag(tenant, tag.id, vmId).catch(() => undefined); // idempotente
};

/** Remueve el tag del tenant de una VM. */
export const removeTenantTag = async (tenant: TenantConfig, vmId: string) => {
  const tagName = expectedTenantTagName(tenant);
  if (!tagName) return;
  const tags = await listTags(tenant);
  const tag = tags.find((t) => t.name === tagName);
  if (tag) await detachTag(tenant, tag.id, vmId).catch(() => undefined);
};

export const vmMatchesTenantTag = (tagNames: string[], expectedTag?: string) => {
  const expected = expectedTag?.trim().toLowerCase();
  if (!expected) return false;
  return tagNames.some((name) => name.trim().toLowerCase() === expected);
};

const fetchVmTagNames = async (tenant: TenantConfig, vmId: string): Promise<string[]> => {
  const ids = await listVmTagIds(tenant, vmId);
  if (!ids.length) return [];
  const all = await listTags(tenant);
  const byId = new Map(all.map((t) => [t.id, t.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
};

/**
 * Fail-closed igual que en OLVM: toda operacion sobre una VM exige que la VM
 * tenga el tag del tenant (los superadmins del portal bypassean en la capa de
 * rutas, no aqui).
 */
export const enforceVmTagPolicy = async (tenantId: string, vmId: string) => {
  const tenant = await getTenantById(tenantId);
  const expectedTag = tenant.tag?.trim();
  if (!expectedTag) {
    throw new Error(`Forbidden: tenant ${tenantId} no tiene un tag configurado`);
  }
  const tagNames = await fetchVmTagNames(tenant, vmId);
  if (!vmMatchesTenantTag(tagNames, expectedTag)) {
    throw new Error(`Forbidden: VM ${vmId} no tiene tag del tenant (${expectedTag})`);
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * VMs — listado, detalle, poder
 * ──────────────────────────────────────────────────────────────────────── */

type VcenterVm = {
  vm: string;
  name: string;
  power_state: "POWERED_OFF" | "POWERED_ON" | "SUSPENDED";
  memory_size_MiB?: number;
  cpu_count?: number;
  host?: string;
  cluster?: string;
};

const normalizeStatus = (state: VcenterVm["power_state"]): string =>
  state === "POWERED_ON" ? "up" : state === "SUSPENDED" ? "suspended" : "down";

const toSummary = (vm: VcenterVm, tagNames: string[]): VmSummary => ({
  id: vm.vm,
  name: vm.name,
  status: normalizeStatus(vm.power_state),
  cluster: vm.cluster,
  host: vm.host,
  memoryMB: vm.memory_size_MiB,
  cpuCores: vm.cpu_count,
  sockets: undefined,
  tags: tagNames,
});

const listAllVms = (tenant: TenantConfig) => viFetch<VcenterVm[]>(tenant, "/api/vcenter/vms");

/**
 * Lista las VMs del tenant: objetos attachados al tag del tenant, joineados
 * contra /api/vcenter/vms. En entornos muy grandes se puede cachear el listado
 * (TODO(lab): medir latencia y decidir cache con TTL).
 */
export const fetchVms = async (tenantId: string): Promise<VmSummary[]> => {
  const tenant = await getTenantById(tenantId);
  const tagName = expectedTenantTagName(tenant);
  if (!tagName) throw new Error(`Forbidden: tenant ${tenantId} no tiene un tag configurado`);

  const tags = await listTags(tenant);
  const tag = tags.find((t) => t.name === tagName);
  if (!tag) return []; // tenant sin VMs todavia

  const [attached, allVms] = await Promise.all([
    listAttachedObjects(tenant, tag.id),
    listAllVms(tenant),
  ]);
  const attachedVmIds = new Set(
    attached.filter((o) => o.type === "VirtualMachine").map((o) => o.id),
  );
  return allVms
    .filter((vm) => attachedVmIds.has(vm.vm))
    .map((vm) => toSummary(vm, [tagName]))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchVmById = async (
  tenantId: string,
  vmId: string,
): Promise<VmSummary | null> => {
  const tenant = await getTenantById(tenantId);
  await enforceVmTagPolicy(tenantId, vmId);
  const all = await listAllVms(tenant);
  const vm = all.find((v) => v.vm === vmId);
  if (!vm) return null;
  const tagNames = await fetchVmTagNames(tenant, vmId);
  return toSummary(vm, tagNames);
};

/** Acciones soportadas (vocabulario comun del portal). */
export const ALLOWED_ACTIONS = ["start", "stop", "shutdown", "reboot", "suspend", "hibernate"];

export const isSupportedAction = (action: string) => ALLOWED_ACTIONS.includes(action);

/**
 * Mapeo de acciones del portal a vCenter:
 *   start -> power/start          stop -> power/stop (duro, paridad OLVM)
 *   shutdown -> guest shutdown (Tools) con fallback power/stop
 *   reboot -> power/reset         suspend/hibernate -> power/suspend
 */
export const sendVmAction = async (tenantId: string, vmId: string, action: string) => {
  if (!isSupportedAction(action)) throw new Error(`Unsupported VM action: ${action}`);
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);

  if (action === "shutdown") {
    await viFetch(tenant, `/api/vcenter/vm/${vmId}/guest/power?action=shutdown`, { method: "POST" })
      .catch(() => viFetch(tenant, `/api/vcenter/vm/${vmId}/power/stop`, { method: "POST" }));
    return;
  }

  const powerAction =
    action === "start" ? "start"
    : action === "stop" ? "stop"
    : action === "reboot" ? "reset"
    : "suspend"; // suspend | hibernate
  await viFetch(tenant, `/api/vcenter/vm/${vmId}/power/${powerAction}`, { method: "POST" });
};

export const deleteVm = async (tenantId: string, vmId: string) => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  await viFetch(tenant, `/api/vcenter/vm/${vmId}/power/stop`, { method: "POST" }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 3000));
  await viFetch(tenant, `/api/vcenter/vm/${vmId}`, { method: "DELETE" });
};

/* ────────────────────────────────────────────────────────────────────────────
 * Consola — WebMKS ticket por nuestro proxy WS (wss://)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * vCenter >= 7.0U2: POST /api/vcenter/vm/{vm}/console/tickets -> {"ticket": "wss://vc:7343/ticket/..."}
 * La URL ES un websocket WebMKS: encaja directo en el proxy de consola
 * existente (wsProxy soporta wss:// con allowInsecure/CA del engine).
 */
export const fetchVmConsoleInfo = async (
  tenantId: string,
  vmId: string,
  _protocol = "webmks",
): Promise<ConsoleInfo> => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  // TODO(lab): validar forma exacta del ticket en el vCenter del laboratorio
  // (7 vs 8) y el tipo WEBMKS vs VMRC si el endpoint lo exige.
  const res = await viFetch<{ ticket: string }>(tenant, "/api/vcenter/vm/${vm}/console/tickets"
    .replace("${vm}", vmId), {
    method: "POST",
    body: JSON.stringify({ type: "WEBMKS" }),
  });
  const ticketUrl = res.ticket;
  return {
    protocol: "webmks",
    consoleId: vmId,
    ticket: ticketUrl,
    websocket: { wsUrl: ticketUrl },
  };
};

/* ────────────────────────────────────────────────────────────────────────────
 * Inventario — clusters, hosts, datastores, redes
 * ──────────────────────────────────────────────────────────────────────── */

export const fetchClusters = async (tenantId: string): Promise<OlvmCluster[]> => {
  const tenant = await getTenantById(tenantId);
  const list = await viFetch<{ cluster: string; name: string }[]>(tenant, "/api/vcenter/cluster");
  return list
    .map((c) => ({ id: c.cluster, name: c.name }))
    .filter((c) => c.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchHosts = async (tenantId: string): Promise<OlvmHost[]> => {
  const tenant = await getTenantById(tenantId);
  const list = await viFetch<{ host: string; name: string; connection_state?: string }[]>(
    tenant,
    "/api/vcenter/host",
  );
  return list
    .filter((h) => h.connection_state !== "NOT_RESPONDING" && h.connection_state !== "DISCONNECTED")
    .map((h) => ({ id: h.host, name: h.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchStorageDomains = async (tenantId: string): Promise<StorageDomainInfo[]> => {
  const tenant = await getTenantById(tenantId);
  type Ds = {
    datastore: string; name: string; type: string; capacity?: number; free_space?: number;
  };
  const list = await viFetch<Ds[]>(tenant, "/api/vcenter/datastore");
  const allowedNames = [...(tenant.storageDomains ?? []), ...(tenant.sharedStorageDomains ?? [])];
  const mapped = list.map((ds) => {
    const capacity = ds.capacity ?? 0;
    const free = ds.free_space ?? 0;
    return {
      id: ds.datastore,
      name: ds.name,
      type: ds.type,
      status: "accessible",
      availableGB: bytesToGB(free),
      usedGB: bytesToGB(capacity - free),
      totalGB: bytesToGB(capacity),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Mismo criterio OLVM: si el tenant define datastores, se filtra por nombre.
  return allowedNames.length ? mapped.filter((ds) => allowedNames.includes(ds.name)) : mapped;
};

export const fetchNetworks = async (tenantId: string): Promise<OlvmNetwork[]> => {
  const tenant = await getTenantById(tenantId);
  const list = await viFetch<{ network: string; name: string; type: string }[]>(
    tenant,
    "/api/vcenter/network",
  );
  const allowed = tenant.networks ?? [];
  const mapped = list
    .map((n) => ({ id: n.network, name: n.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return allowed.length ? mapped.filter((n) => allowed.includes(n.name)) : mapped;
};

/**
 * vSphere no tiene "vnic profiles" como oVirt: el attach se hace contra la
 * red (network id) directamente. Devolvemos las redes como perfiles para que
 * la UI/wizard reutilice el mismo flujo.
 */
export const fetchVnicProfiles = async (tenantId: string): Promise<VnicProfile[]> => {
  const networks = await fetchNetworks(tenantId);
  return networks.map((n) => ({ id: n.id, name: n.name, networkId: n.id }));
};

/** TODO(lab): templates via Content Library (OVF/vVMTX) o VMs marcadas template. */
export const fetchTemplates = async (_tenantId: string): Promise<OlvmTemplate[]> => [];

/* ────────────────────────────────────────────────────────────────────────────
 * Creacion / clon / recursos
 * ──────────────────────────────────────────────────────────────────────── */

type CreateVmInput = {
  name: string;
  clusterId?: string;
  hostId?: string;
  datastoreId?: string;
  resourcePoolId?: string;
  folderId?: string;
  memoryMB?: number;
  cpuCores?: number;
  guestOsType?: string; // ej. "VMWARE_ESX_7_0_GUEST_..."; en blanco = otherGuest
  networkId?: string;
};

/** Creacion de VM "blank" via vAPI com.vmware.vcenter.VM.create. */
export const createVm = async (tenantId: string, input: CreateVmInput): Promise<string> => {
  const tenant = await getTenantById(tenantId);
  const placement: Record<string, string> = {};
  if (input.folderId) placement.folder = input.folderId;
  if (input.hostId) placement.host = input.hostId;
  if (input.clusterId) placement.cluster = input.clusterId;
  if (input.datastoreId) placement.datastore = input.datastoreId;
  if (input.resourcePoolId) placement.resource_pool = input.resourcePoolId;

  const vmId = await vapi<string>(tenant, "vcenter.VM", "create", {
    spec: {
      name: input.name,
      guest_OS: input.guestOsType || "OTHER_GUEST",
      placement,
      cpu: { count: input.cpuCores ?? 1 },
      memory: { size_MiB: input.memoryMB ?? 2048 },
    },
  });
  await applyTenantTag(tenant, vmId);
  return vmId;
};

type CloneVmProgress = (stage: string, progress: number) => void | Promise<void>;

export type CloneVmStage =
  | "submitting" | "waiting" | "tagging" | "stopping" | "networking" | "disks";

/**
 * Clone via vAPI com.vmware.vcenter.vm.{vm}.clone (funciona 6.7->8.x).
 * Paridad con el flujo OLVM: clona, espera, taggea y apaga la copia.
 */
export const cloneVm = async (
  tenantId: string,
  sourceVmId: string,
  cloneName: string,
  onProgress?: CloneVmProgress,
): Promise<{ vmId: string }> => {
  const tenant = await getTenantById(tenantId);
  await enforceVmTagPolicy(tenantId, sourceVmId);

  await onProgress?.("submitting", 10);
  const newVmId = await vapi<{ vm?: string }>(tenant, "vcenter.vm", "clone", {
    source: sourceVmId,
    spec: { name: cloneName },
  }).then((r) => {
    const id = typeof r === "string" ? r : r?.vm;
    if (!id) throw new Error("Clone no devolvio vm id");
    return id;
  });

  await onProgress?.("waiting", 40);
  // Espera: la VM clonada aparece en /api/vcenter/vms
  for (let i = 0; i < 60; i++) {
    const all = await listAllVms(tenant);
    if (all.some((v) => v.vm === newVmId)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  await onProgress?.("tagging", 60);
  await applyTenantTag(tenant, newVmId);

  await onProgress?.("stopping", 80);
  await viFetch(tenant, `/api/vcenter/vm/${newVmId}/power/stop`, { method: "POST" }).catch(() => undefined);

  await onProgress?.("completed", 100);
  return { vmId: newVmId };
};

type UpdateVmInput = { memoryMB?: number; cpuCores?: number; sockets?: number };

export const updateVmResources = async (
  tenantId: string,
  vmId: string,
  payload: UpdateVmInput,
) => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  if (payload.cpuCores) {
    await vapi(tenant, "vcenter.vm.hardware.cpu", "update", {
      vm: vmId,
      spec: { count: payload.cpuCores },
    });
  }
  if (payload.memoryMB) {
    await vapi(tenant, "vcenter.vm.hardware.memory", "update", {
      vm: vmId,
      spec: { size_MiB: payload.memoryMB },
    });
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * Fase 2 (post-lab) — documentadas en docs/vmware-architecture.md
 *  - Discos:    vcenter.vm.hardware.disk (+ create spec con datastore)
 *  - NICs:      vcenter.vm.hardware.ethernet (+ nic.yaml default backing network)
 *  - CDROM/ISO: vcenter.vm.hardware.cdrom + Content Library item
 *  - OVA/OVF:   Content Library (library-item OVF deploy) u ovftool
 *  - Metricas:  vAPI vstats o perfmanager (cpu/mem %)
 * ──────────────────────────────────────────────────────────────────────── */
