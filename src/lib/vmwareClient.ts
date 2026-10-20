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

import path from "path";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { getTenantById, type TenantConfig } from "./config";
import { getOvaUploadPaths } from "./ovaStaging";

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
  invalidateVersionCache(tenantId);
  if (tenantId) {
    for (const key of capabilityCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) capabilityCache.delete(key);
    }
  } else {
    capabilityCache.clear();
  }
  if (tenantId) taggingTransportCache.delete(tenantId);
  else taggingTransportCache.clear();
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

// Prueba una conexión (guardada o no) contra el vCenter. Mismo contrato que olvmClient.
export const testConnection = async (input: {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  caCert?: Buffer | string;
}): Promise<import("./olvmClient").ConnectionTestResult> => {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const ca = input.caCert
    ? typeof input.caCert === "string"
      ? input.caCert
      : input.caCert.toString()
    : undefined;
  const dispatcher = new UndiciAgent({
    connect: input.allowInsecure ? { rejectUnauthorized: false } : ca ? { ca } : undefined,
  });

  if (!input.username || !input.password) {
    return { ok: false, status: 401, detail: "Usuario y password requeridos (sesión vCenter)" };
  }
  try {
    const basic = Buffer.from(`${input.username}:${input.password}`, "utf-8").toString("base64");
    const res = await undiciFetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
      dispatcher: dispatcher as never,
    });
    if (res.status === 401) return { ok: false, status: 401, detail: "Credenciales inválidas" };
    if (!res.ok) {
      return { ok: false, status: res.status, detail: `Respuesta inesperada (HTTP ${res.status})` };
    }
    const token = (await res.json()) as string;

    let detail = "Conexión exitosa";
    try {
      const vres = await undiciFetch(`${baseUrl}/api/appliance/system/version`, {
        headers: { "vmware-api-session-id": token },
        dispatcher: dispatcher as never,
      });
      if (vres.ok) {
        const v = (await vres.json()) as { product?: string; version?: string };
        detail = `Conexión exitosa — ${v.product ?? "vCenter"} ${v.version ?? ""}`.trim();
      }
    } catch {
      // sin versión no invalida el test
    }
    return { ok: true, status: 200, detail };
  } catch (error) {
    return { ok: false, status: 0, detail: `No se pudo conectar: ${(error as Error).message}` };
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * Version de vCenter + matriz de capacidades (7.x / 8.x / 9.x)
 *
 * vSphere 9 (VCF 9) ELIMINA los endpoints legacy /rest (vAPI JSON-RPC).
 * 7.x/8.x exponen REST moderno (/api) parcialmente: algunas operaciones solo
 * existen como vAPI. Estrategia: detectar version y resolver cada operacion
 * con "candidatos" ordenados; el primer endpoint que responde queda cacheado
 * por engine+capacidad (sin re-probar en cada llamada).
 * ──────────────────────────────────────────────────────────────────────── */

const versionCache = new Map<string, string>();

/** Ej. "7.0.3-xxxx", "8.0.2-xxxx", "9.0.0-xxxx"; "" si no se pudo determinar. */
export const getVcenterVersion = async (tenant: TenantConfig): Promise<string> => {
  if (versionCache.has(tenant.id)) return versionCache.get(tenant.id)!;
  let version = "";
  try {
    const info = await viFetch<{ version?: string }>(
      tenant,
      "/api/appliance/system/version",
    );
    version = info?.version ?? "";
  } catch {
    version = "";
  }
  versionCache.set(tenant.id, version);
  return version;
};

const invalidateVersionCache = (tenantId?: string) => {
  if (tenantId) versionCache.delete(tenantId);
  else versionCache.clear();
};

const majorOf = (version: string) => Number.parseInt(version.split(".")[0] ?? "0", 10) || 0;

export const isVsphere9 = async (tenant: TenantConfig) => {
  const v = await getVcenterVersion(tenant);
  return v !== "" && majorOf(v) >= 9;
};

type CapabilityRequest = {
  /** Endpoint REST moderno (/api). Requerido en 9.x. */
  api?: { method: string; path: string; build?: (payload: unknown) => unknown };
  /** Servicio vAPI legacy (/rest). Solo 7.x/8.x. */
  vapi?: { service: string; action: string; build?: (payload: unknown) => unknown };
};

const capabilityCache = new Map<string, "api" | "vapi">();

/**
 * Ejecuta una operacion probando candidatos por version:
 *   - 9.x: solo `api` (vAPI /rest fue removido)
 *   - 7/8: `api` primero si existe, fallback `vapi`
 * La resolucion exitosa se cachea por engine+capacidad.
 */
const runCapability = async <T>(
  tenant: TenantConfig,
  capability: string,
  spec: CapabilityRequest,
  payload: unknown,
): Promise<T> => {
  const cacheKey = `${tenant.id}:${capability}`;
  const is9 = await isVsphere9(tenant);
  const order: ("api" | "vapi")[] = is9
    ? spec.api ? ["api"] : []
    : spec.api && spec.vapi ? ["api", "vapi"]
    : spec.api ? ["api"]
    : ["vapi"];

  if (!order.length) {
    throw new Error(`Capacidad ${capability} sin endpoint para vSphere ${is9 ? "9.x" : "7/8.x"}`);
  }

  // Respetar resolucion cacheada (evita re-probar el fallback en cada llamada)
  const resolved = capabilityCache.get(cacheKey);
  const attempts = resolved ? [resolved] : order;
  const errors: string[] = [];

  for (const transport of attempts) {
    try {
      if (transport === "api" && spec.api) {
        const body = spec.api.build ? spec.api.build(payload) : payload;
        const result = await viFetch<T>(tenant, spec.api.path, {
          method: spec.api.method,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        capabilityCache.set(cacheKey, "api");
        return result;
      }
      if (transport === "vapi" && spec.vapi) {
        const body = spec.vapi.build ? spec.vapi.build(payload) : payload;
        const result = await vapi<T>(tenant, spec.vapi.service, spec.vapi.action, body);
        capabilityCache.set(cacheKey, "vapi");
        return result;
      }
    } catch (error) {
      errors.push(`${transport}: ${error instanceof Error ? error.message : String(error)}`);
      // 404/405 = endpoint no existe en esta version: probar el siguiente transporte
    }
  }
  throw new Error(`${capability} fallo en todos los transports -> ${errors.join(" | ")}`);
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
 *
 * vSphere 7/8 expone estos servicios en dos transportes:
 *   - REST nuevo: /api/cis/tagging/... (arrays/objetos directos)
 *   - vAPI historico: /rest/com/vmware/cis/tagging/... (sobre {value}, listas de IDs)
 * En 9.x solo existe el REST nuevo; este lab (8.0.3) 404a el REST nuevo, asi
 * que cada operacion prueba `api` y cae a `vapi` (cacheado por engine).
 * ──────────────────────────────────────────────────────────────────────── */

type TaggingCategory = { id: string; name: string; cardinality: string };
type TaggingTag = { id: string; name: string; category_id: string };
type TaggableObject = { id: string; type: string };

type TaggingTransport = "api" | "vapi";
const taggingTransportCache = new Map<string, TaggingTransport>();

/** Ejecuta la operacion de tagging en el transporte que funcione para el engine. */
const withTagging = async <T>(
  tenant: TenantConfig,
  apiCall: () => Promise<T>,
  vapiCall: () => Promise<T>,
): Promise<T> => {
  const cached = taggingTransportCache.get(tenant.id);
  const order: TaggingTransport[] = cached ? [cached] : ["api", "vapi"];
  let lastError: unknown = null;
  for (const transport of order) {
    try {
      const result = transport === "api" ? await apiCall() : await vapiCall();
      taggingTransportCache.set(tenant.id, transport);
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`tagging fallo en ambos transports: ${lastError.message}`)
    : new Error("tagging fallo");
};

const ensureCategory = async (tenant: TenantConfig): Promise<TaggingCategory> => {
  const createSpec = {
    create_spec: {
      name: TENANT_CATEGORY,
      description: "Tenant tags managed by VIRTUAL-PORTAL",
      cardinality: "MULTIPLE",
      associable_types: ["VirtualMachine"],
    },
  };
  return withTagging(
    tenant,
    async () => {
      const categories = await viFetch<TaggingCategory[]>(tenant, "/api/cis/tagging/categories");
      const found = categories.find((c) => c.name === TENANT_CATEGORY);
      if (found) return found;
      return viFetch<TaggingCategory>(tenant, "/api/cis/tagging/categories", {
        method: "POST",
        body: JSON.stringify(createSpec),
      });
    },
    async () => {
      const ids = (await vapi<string[]>(tenant, "cis.tagging.category", "list")) ?? [];
      for (const id of ids) {
        const cat = await vapi<{ name: string; cardinality: string }>(
          tenant, "cis.tagging.category", "get", { category_id: id },
        );
        if (cat?.name === TENANT_CATEGORY) {
          return { id, name: cat.name, cardinality: cat.cardinality };
        }
      }
      const id = await vapi<string>(tenant, "cis.tagging.category", "create", createSpec);
      return { id, name: TENANT_CATEGORY, cardinality: "MULTIPLE" };
    },
  );
};

const listTags = (tenant: TenantConfig): Promise<TaggingTag[]> =>
  withTagging(
    tenant,
    () => viFetch<TaggingTag[]>(tenant, "/api/cis/tagging/tags"),
    async () => {
      const ids = (await vapi<string[]>(tenant, "cis.tagging.tag", "list")) ?? [];
      const tags: TaggingTag[] = [];
      for (const id of ids) {
        const tag = await vapi<{ name: string; category_id: string }>(
          tenant, "cis.tagging.tag", "get", { tag_id: id },
        );
        if (tag) tags.push({ id, name: tag.name, category_id: tag.category_id });
      }
      return tags;
    },
  );

const ensureTenantTag = async (tenant: TenantConfig, tagName: string): Promise<TaggingTag> => {
  const category = await ensureCategory(tenant);
  const tags = await listTags(tenant);
  const found = tags.find((t) => t.name === tagName && t.category_id === category.id);
  if (found) return found;
  const createSpec = {
    create_spec: { name: tagName, description: `Tenant ${tagName}`, category_id: category.id },
  };
  return withTagging(
    tenant,
    () =>
      viFetch<TaggingTag>(tenant, "/api/cis/tagging/tags", {
        method: "POST",
        body: JSON.stringify(createSpec),
      }),
    async () => {
      const id = await vapi<string>(tenant, "cis.tagging.tag", "create", createSpec);
      return { id, name: tagName, category_id: category.id };
    },
  );
};

const attachTag = (tenant: TenantConfig, tagId: string, objectId: string, objectType = "VirtualMachine") => {
  const payload = { tag_id: tagId, object_id: { id: objectId, type: objectType } };
  return withTagging(
    tenant,
    () =>
      viFetch(tenant, "/api/cis/tagging/tag-association?~action=attach", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => vapi(tenant, "cis.tagging.tag-association", "attach", payload),
  );
};

const detachTag = (tenant: TenantConfig, tagId: string, objectId: string, objectType = "VirtualMachine") => {
  const payload = { tag_id: tagId, object_id: { id: objectId, type: objectType } };
  return withTagging(
    tenant,
    () =>
      viFetch(tenant, "/api/cis/tagging/tag-association?~action=detach", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => vapi(tenant, "cis.tagging.tag-association", "detach", payload),
  );
};

const listAttachedObjects = async (tenant: TenantConfig, tagId: string): Promise<TaggableObject[]> =>
  withTagging(
    tenant,
    async () => {
      const res = await viFetch<{ associated_objects?: TaggableObject[] }>(
        tenant,
        "/api/cis/tagging/tag-association?~action=list-attached-objects",
        { method: "POST", body: JSON.stringify({ tag_id: tagId }) },
      );
      return res.associated_objects ?? [];
    },
    async () => {
      const res = await vapi<TaggableObject[]>(
        tenant, "cis.tagging.tag-association", "list-attached-objects", { tag_id: tagId },
      );
      return res ?? [];
    },
  );

const listVmTagIds = async (tenant: TenantConfig, vmId: string): Promise<string[]> =>
  withTagging(
    tenant,
    async () => {
      const res = await viFetch<{ tag_ids?: string[] }>(
        tenant,
        "/api/cis/tagging/tag-association?~action=list-attached-tags",
        { method: "POST", body: JSON.stringify({ object_id: { id: vmId, type: "VirtualMachine" } }) },
      );
      return res.tag_ids ?? [];
    },
    async () => {
      const res = await vapi<string[]>(
        tenant, "cis.tagging.tag-association", "list-attached-tags",
        { object_id: { id: vmId, type: "VirtualMachine" } },
      );
      return res ?? [];
    },
  );

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

/** Wrappers tenantId-based (paridad con la superficie comun del dispatcher). */
export const assignTagToVm = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  await applyTenantTag(tenant, vmId);
};

export const removeTagFromVm = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  await removeTenantTag(tenant, vmId);
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

const listAllVms = (tenant: TenantConfig) => viFetch<VcenterVm[]>(tenant, "/api/vcenter/vm");

/**
 * Lista las VMs del tenant: objetos attachados al tag del tenant, joineados
 * contra /api/vcenter/vm. En entornos muy grandes se puede cachear el listado
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


/* El endpoint de power cambia entre builds: /power/{action} (viejo) vs
 * /power?action={action} (nuevo, este vCenter 8.0.3). Probamos ambos. */
const powerCache = new Map<string, "path" | "query">();
const doPower = async (tenant: TenantConfig, vmId: string, action: string) => {
  const cached = powerCache.get(tenant.id);
  const order = cached ? [cached] : (["path", "query"] as const);
  let last: unknown = null;
  for (const style of order) {
    const path = style === "path"
      ? `/api/vcenter/vm/${vmId}/power/${action}`
      : `/api/vcenter/vm/${vmId}/power?action=${action}`;
    try {
      const r = await viFetch(tenant, path, { method: "POST" });
      powerCache.set(tenant.id, style);
      return r;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(`power ${action} fallo`);
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
      .catch(() => doPower(tenant, vmId, "stop"));
    return;
  }

  const powerAction =
    action === "start" ? "start"
    : action === "stop" ? "stop"
    : action === "reboot" ? "reset"
    : "suspend"; // suspend | hibernate
  await doPower(tenant, vmId, powerAction);
};

export const deleteVm = async (tenantId: string, vmId: string) => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  await doPower(tenant, vmId, "stop").catch(() => undefined);
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
  // El endpoint /ticket/ del host sirve RFB (VNC), no WebMKS: verificado contra
  // este laboratorio (primeros bytes "RFB 003.008"). El proxy de consola lo
  // tunelea y el navegador lo consume con noVNC.
  return {
    protocol: "vnc",
    consoleId: vmId,
    ticket: ticketUrl,
    websocket: { wsUrl: ticketUrl },
  };
};

/**
 * Ticket VMRC (VMware Remote Console): abre la app de escritorio con un clic.
 * POST /api/vcenter/vm/{vm}/console/tickets {"type":"VMRC"} -> vmrc://clone:...
 */
export const fetchVmrcConsoleUrl = async (tenantId: string, vmId: string): Promise<string> => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  const res = await viFetch<{ ticket: string }>(
    tenant,
    `/api/vcenter/vm/${vmId}/console/tickets`,
    { method: "POST", body: JSON.stringify({ type: "VMRC" }) },
  );
  if (!res?.ticket?.startsWith("vmrc://")) {
    throw new Error("El vCenter no devolvió un ticket VMRC válido");
  }
  return res.ticket;
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
  return listAllDatastores(tenant);
};

/** Datastores de un engine sin filtro por tenant (para el setup de tenants). */
export const listAllDatastores = async (tenant: TenantConfig): Promise<StorageDomainInfo[]> => {
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
      // El UI filtra por type === "data" (semantica oVirt de storage domain).
      type: "data",
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

/* ────────────────────────────────────────────────────────────────────────────
 * NICs de una VM
 *  - Listado: detalle REST (GET /api/vcenter/vm/{vm} -> nics)
 *  - Mutaciones: SOAP ReconfigVM_Task (este build no expone REST de NICs)
 * ──────────────────────────────────────────────────────────────────────── */

type RawNic = {
  label?: string;
  mac_address?: string;
  backing?: { type?: string; network?: string; network_name?: string };
  state?: string | { connected?: boolean; start_connected?: boolean };
  start_connected?: boolean;
  type?: string;
};

type VmDetailWithNics = { power_state?: string; nics?: Record<string, RawNic> };

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ── SOAP base (login + cookie por engine) ──────────────────────────────── */

const soapSessions = new Map<string, string>();
const SOAP_ENV = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:vim25" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<soapenv:Body>${inner}</soapenv:Body>
</soapenv:Envelope>`;

const soapLogin = async (tenant: TenantConfig): Promise<string> => {
  const body = SOAP_ENV(
    `<Login><_this type="SessionManager">SessionManager</_this>` +
    `<userName>${escapeXml(tenant.username ?? "")}</userName>` +
    `<password>${escapeXml(tenant.password ?? "")}</password></Login>`,
  );
  const res = await undiciFetch(`${tenant.baseUrl}/sdk`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"urn:vim25"' },
    body,
    dispatcher: getDispatcher(tenant) as never,
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!res.ok || !cookie.includes("vmware_soap_session")) {
    throw new Error(`SOAP login fallo (${res.status})`);
  }
  return cookie;
};

const soapCall = async (tenant: TenantConfig, inner: string, retry = true): Promise<string> => {
  let cookie = soapSessions.get(tenant.id);
  if (!cookie) {
    cookie = await soapLogin(tenant);
    soapSessions.set(tenant.id, cookie);
  }
  const res = await undiciFetch(`${tenant.baseUrl}/sdk`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"urn:vim25"',
      Cookie: cookie,
    },
    body: SOAP_ENV(inner),
    dispatcher: getDispatcher(tenant) as never,
  });
  const text = await res.text();
  if (text.includes("NotAuthenticated") && retry) {
    soapSessions.delete(tenant.id);
    return soapCall(tenant, inner, false);
  }
  if (text.includes("<soapenv:Fault>") || text.includes("<Fault>")) {
    const msg = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(text)?.[1] ?? "error SOAP";
    throw new Error(`SOAP: ${msg.replace(/&apos;/g, "'").replace(/&quot;/g, '"').slice(0, 200)}`);
  }
  return text;
};

const reconfigureVm = (vmId: string, deviceChange: string) =>
  `<ReconfigVM_Task><_this type="VirtualMachine">${vmId}</_this>` +
  `<spec><deviceChange>${deviceChange}</deviceChange></spec></ReconfigVM_Task>`;

const reconfigureSpec = (vmId: string, specInner: string) =>
  `<ReconfigVM_Task><_this type="VirtualMachine">${vmId}</_this>` +
  `<spec>${specInner}</spec></ReconfigVM_Task>`;

/** Espera a que la cantidad de NICs en el detalle REST cambie (add/remove). */
const waitNicCount = async (tenant: TenantConfig, vmId: string, expected: number) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const d = await viFetch<VmDetailWithNics>(tenant, `/api/vcenter/vm/${vmId}`).catch(() => null);
    if (d && Object.keys(d.nics ?? {}).length === expected) return;
  }
  throw new Error("La NIC no reflejo el cambio a tiempo en vCenter");
};

/* ── Operaciones ─────────────────────────────────────────────────────────── */

export const fetchVmNics = async (tenantId: string, vmId: string): Promise<import("./olvmClient").VmNic[]> => {
  const tenant = await getTenantById(tenantId);
  const detail = await viFetch<VmDetailWithNics>(tenant, `/api/vcenter/vm/${vmId}`);
  const nics: import("./olvmClient").VmNic[] = [];
  for (const [key, raw] of Object.entries(detail.nics ?? {})) {
    const connected = typeof raw.state === "string" ? raw.state === "CONNECTED" : (raw.state?.connected ?? false);
    nics.push({
      id: key,
      name: raw.label ?? key,
      mac: raw.mac_address ?? "",
      linked: connected,
      plugged: typeof raw.state === "object" ? (raw.state?.start_connected ?? false) : (raw.start_connected ?? false),
      interface: raw.type ?? raw.backing?.type ?? "",
      networkId: raw.backing?.network ?? "",
      networkName: raw.backing?.network_name ?? raw.backing?.network ?? "",
      vnicProfileId: raw.backing?.network ?? "",
    });
  }
  return nics.sort((a, b) => a.id.localeCompare(b.id));
};

export const addNicToVm = async (
  tenantId: string,
  vmId: string,
  params: { name?: string; interface?: string; vnicProfileId: string },
): Promise<void> => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  const networks = await fetchNetworks(tenantId);
  const networkName =
    networks.find((n) => n.id === params.vnicProfileId)?.name ?? "VM Network";

  const before = await viFetch<VmDetailWithNics>(tenant, `/api/vcenter/vm/${vmId}`);
  const expected = Object.keys(before.nics ?? {}).length + 1;

  await soapCall(tenant, reconfigureVm(vmId,
    `<operation>add</operation>` +
    `<device xsi:type="VirtualVmxnet3">` +
    `<key>-1</key>` +
    `<backing xsi:type="VirtualEthernetCardNetworkBackingInfo"><deviceName>${escapeXml(networkName)}</deviceName></backing>` +
    `<connectable><startConnected>true</startConnected><allowGuestControl>true</allowGuestControl><connected>true</connected></connectable>` +
    `<addressType>generated</addressType>` +
    `</device>`));
  await waitNicCount(tenant, vmId, expected);
};

export const updateNicLink = async (
  tenantId: string,
  vmId: string,
  nicId: string,
  linked: boolean,
): Promise<void> => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  const current = (await fetchVmNics(tenantId, vmId)).find((n) => n.id === nicId);
  await soapCall(tenant, reconfigureVm(vmId,
    `<operation>edit</operation>` +
    `<device xsi:type="VirtualVmxnet3">` +
    `<key>${Number(nicId)}</key>` +
    `<backing xsi:type="VirtualEthernetCardNetworkBackingInfo"><deviceName>${escapeXml(current?.networkName || "VM Network")}</deviceName></backing>` +
    `<connectable><startConnected>${linked}</startConnected><allowGuestControl>true</allowGuestControl><connected>${linked}</connected></connectable>` +
    `</device>`));
};

export const deleteNicFromVm = async (
  tenantId: string,
  vmId: string,
  nicId: string,
): Promise<void> => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);
  const before = await viFetch<VmDetailWithNics>(tenant, `/api/vcenter/vm/${vmId}`);
  const expected = Math.max(0, Object.keys(before.nics ?? {}).length - 1);

  await soapCall(tenant, reconfigureVm(vmId,
    `<operation>remove</operation>` +
    `<device xsi:type="VirtualVmxnet3"><key>${Number(nicId)}</key></device>`));
  await waitNicCount(tenant, vmId, expected);
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

/** Creacion de VM "blank". 9.x: REST POST /api/vcenter/vm; 7/8: vAPI VM.create.
 *  El REST de vCenter 8 espera el create_spec directo en el body (sin wrapper
 *  {"spec": ...}); con wrapper el parser marca todos los campos como unknown.
 *  Placement obligatorio: datastore + folder + (cluster|host|resource_pool);
 *  sin datastore el endpoint lo rutea a "register" y exige datastore+path. */
export const createVm = async (tenantId: string, input: CreateVmInput): Promise<string> => {
  const tenant = await getTenantById(tenantId);
  const placement: Record<string, string> = {};
  if (input.folderId) placement.folder = input.folderId;
  if (input.hostId) placement.host = input.hostId;
  if (input.clusterId) placement.cluster = input.clusterId;
  if (input.datastoreId) placement.datastore = input.datastoreId;
  if (input.resourcePoolId) placement.resource_pool = input.resourcePoolId;

  if (!placement.datastore) {
    const datastores = await listAllDatastores(tenant);
    const best = datastores.sort((a, b) => b.availableGB - a.availableGB)[0];
    if (!best) throw new Error("No hay datastores disponibles para crear la VM");
    placement.datastore = best.id;
  }
  if (!placement.folder) {
    const folders = await viFetch<{ folder: string; name: string }[]>(
      tenant,
      "/api/vcenter/folder?type=VIRTUAL_MACHINE",
    );
    placement.folder = (folders.find((f) => f.name === "vm") ?? folders[0])?.folder;
    if (!placement.folder) throw new Error("No hay carpetas de VMs disponibles para crear la VM");
  }

  // guest_OS exige el enum vSphere (UBUNTU_64, WINDOWS_11_64...). Bundles viejos
  // del frontend mandan valores tipo "linux": caen a OTHER (este build no acepta
  // OTHER_GUEST en el enum REST).
  const VSPHERE_GUEST_OS = new Set([
    "DOS", "FREEBSD_64", "MANDRAKE", "MANDRAKE64", "OS2", "OTHER_24X86", "OTHER_24X86_64",
    "OTHER_32", "OTHER_32INUX", "OTHER_64", "OTHER_LINUX", "OTHER_LINUX_64",
    "OTHER_PRE65", "REDHAT", "RHEL_2", "RHEL_3", "RHEL_3_64", "RHEL_4", "RHEL_4_64", "RHEL_5",
    "RHEL_5_64", "RHEL_6", "RHEL_6_64", "RHEL_7", "RHEL_7_64", "RHEL_8_64", "RHEL_9_64",
    "SLES", "SLES_64", "SOLARIS_10", "SOLARIS_10_64", "SOLARIS_11_64", "SOLARIS_6_7",
    "SOLARIS_8", "SOLARIS_9", "UBUNTU", "UBUNTU_64", "WINDOWS_7", "WINDOWS_7_64", "WINDOWS_8",
    "WINDOWS_8_64", "WINDOWS_9_64", "WINDOWS_10", "WINDOWS_10_64", "WINDOWS_11_64",
    "WINDOWS_11_64_ARM", "WINDOWS_2003", "WINDOWS_2003_64", "WINDOWS_2008", "WINDOWS_2008_64",
    "WINDOWS_2012_64", "WINDOWS_2016_64", "WINDOWS_2019_64", "WINDOWS_2022_64", "WINDOWS_HV_2016",
    "WINDOWS_SERVER_2025_BETA", "WINDOWS_XP", "CENTOS_6_64", "CENTOS_7_64", "CENTOS_8_64",
    "DEBIAN_6_64", "DEBIAN_7_64", "DEBIAN_8_64", "DEBIAN_9_64", "DEBIAN_10_64", "DEBIAN_11_64",
    "DEBIAN_12_64", "FEDORA_64", "ORACLE_LINUX_64", "SUSE_64", "VMWARE_PHOTON_64", "VMWARE_ESXI_6",
    "VMWARE_ESXI_7", "VMWARE_ESXI_8",
  ]);
  const guestOs = input.guestOsType && VSPHERE_GUEST_OS.has(input.guestOsType)
    ? input.guestOsType
    : "OTHER";

  const spec = {
    name: input.name,
    guest_OS: guestOs,
    placement,
    cpu: { count: input.cpuCores ?? 1 },
    memory: { size_MiB: input.memoryMB ?? 2048 },
  };

  const vmId = await runCapability<string | { vm?: string }>(
    tenant,
    "vm.create",
    {
      api: { method: "POST", path: "/api/vcenter/vm", build: () => spec },
      vapi: { service: "vcenter.VM", action: "create", build: () => ({ spec }) },
    },
    { spec },
  ).then((r) => {
    const id = typeof r === "string" ? r : r?.vm;
    if (!id) throw new Error("Create no devolvio vm id");
    return id;
  });
  await applyTenantTag(tenant, vmId);
  return vmId;
};

/* ── Importacion OVA (vCenter) ──────────────────────────────────────────
 *  El REST de Content Library (/api/content/library/item, upload-session y
 *  ovf/library-item) no esta expuesto en el lab, asi que el import se hace
 *  por SOAP (OvfManager.CreateImportSpec + CreateVM_Task), el mismo canal
 *  que ovftool. El parser OVF del lab solo acepta OVFs minimos (cpu+mem):
 *  se importa la VM con el hardware equivalente y el disco/NIC se agregan
 *  via REST (mismo criterio que el cliente OLVM original). */
export type ImportOvaVmInput = {
  name: string;
  clusterId?: string;
  storageDomainId?: string;
  hostId?: string;
  uploadId?: string;
  ovaName?: string;
};

const soapTaskPoll = async (tenant: TenantConfig, taskId: string): Promise<{ state: string; leaseId: string; vmId: string; error: string }> => {
  for (let i = 0; i < 60; i++) {
    const t = await soapCall(tenant,
      `<RetrievePropertiesEx><_this type="PropertyCollector">propertyCollector</_this>` +
      `<specSet><propSet><type>Task</type><pathSet>info.state</pathSet><pathSet>info.result</pathSet><pathSet>info.error</pathSet></propSet>` +
      `<objectSet><obj type="Task">${taskId}</obj></objectSet></specSet><options/></RetrievePropertiesEx>`);
    const state = /<name>info\.state<\/name><val xsi:type="TaskInfoState">([^<]+)</.exec(t)?.[1] ?? "";
    if (state === "success") {
      const leaseId = /<name>info\.result<\/name><val xsi:type="ManagedObjectReference" type="HttpNfcLease">([^<]+)</.exec(t)?.[1] ?? "";
      const vmId = /<name>info\.result<\/name><val xsi:type="ManagedObjectReference" type="VirtualMachine">([^<]+)</.exec(t)?.[1] ?? "";
      return { state, leaseId, vmId, error: "" };
    }
    if (state === "error") {
      const fault = /<localizedMessage>([^<]+)<\/localizedMessage>/.exec(t)?.[1]
        ?? /<faultstring>([^<]+)<\/faultstring>/.exec(t)?.[1] ?? "error desconocido";
      return { state, leaseId: "", vmId: "", error: fault };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { state: "timeout", leaseId: "", vmId: "", error: "La tarea de importacion no termino a tiempo" };
};

/** Crea la VM a partir de un OVF minimo via OvfManager. Devuelve el vmId. */
const soapImportCreateVm = async (
  tenant: TenantConfig,
  opts: { name: string; cpu: number; memMb: number; osDesc: string;
          datastoreId: string; resourcePoolId: string; folderId: string; hostId?: string; networkId?: string },
): Promise<string> => {
  const ovf =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1" xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1" ` +
    `xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData" ` +
    `xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <References>\n` +
    `    <File ovf:id="file1" ovf:href="disk0.vmdk" ovf:size="4194304"/>\n` +
    `  </References>\n` +
    `  <DiskSection><Info>Discos</Info>` +
    `<Disk ovf:diskId="vmdisk1" ovf:fileRef="file1" ovf:capacity="64" ovf:capacityAllocationUnits="byte * 2^20" ` +
    `ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized" ovf:populatedSize="0"/></DiskSection>\n` +
    `  <NetworkSection><Info>Redes</Info><Network ovf:name="NET0"/></NetworkSection>\n` +
    `  <VirtualSystem ovf:id="${escapeXml(opts.name)}">\n` +
    `    <Info>VM</Info>\n    <Name>${escapeXml(opts.name)}</Name>\n` +
    `    <OperatingSystemSection ovf:id="100"><Info>Sistema</Info><Description>${escapeXml(opts.osDesc)}</Description></OperatingSystemSection>\n` +
    `    <VirtualHardwareSection><Info>Hardware</Info>\n` +
    `      <System><vssd:ElementName>Virtual Hardware Family</vssd:ElementName><vssd:InstanceID>0</vssd:InstanceID>` +
    `<vssd:VirtualSystemIdentifier>${escapeXml(opts.name)}</vssd:VirtualSystemIdentifier><vssd:VirtualSystemType>vmx-21</vssd:VirtualSystemType></System>\n` +
    `      <Item><rasd:ElementName>${opts.cpu} virtual CPU(s)</rasd:ElementName><rasd:InstanceID>1</rasd:InstanceID>` +
    `<rasd:ResourceType>3</rasd:ResourceType><rasd:VirtualQuantity>${opts.cpu}</rasd:VirtualQuantity></Item>\n` +
    `      <Item><rasd:ElementName>${opts.memMb}MB of memory</rasd:ElementName><rasd:InstanceID>2</rasd:InstanceID>` +
    `<rasd:ResourceType>4</rasd:ResourceType><rasd:VirtualQuantity>${opts.memMb}</rasd:VirtualQuantity></Item>\n` +
    `    </VirtualHardwareSection>\n  </VirtualSystem>\n</Envelope>`;

  const specXml = await soapCall(tenant,
    `<CreateImportSpec>` +
    `<_this type="OvfManager">OvfManager</_this>` +
    `<ovfDescriptor>${escapeXml(ovf)}</ovfDescriptor>` +
    `<resourcePool type="ResourcePool">${opts.resourcePoolId}</resourcePool>` +
    `<datastore type="Datastore">${opts.datastoreId}</datastore>` +
    `<cisp><locale>en</locale><deploymentOption></deploymentOption>` +
    `<entityName>${escapeXml(opts.name)}</entityName>` +
    (opts.networkId
      ? `<networkMapping><name>NET0</name><network type="Network">${opts.networkId}</network></networkMapping>`
      : "") +
    `</cisp></CreateImportSpec>`);
  const importError = /<localizedMessage>([^<]+)<\/localizedMessage>/.exec(specXml)?.[1];
  if (importError) throw new Error(`El OVF no pasa el validador del vCenter: ${importError}`);
  const configInner = /<importSpec[\s\S]*?<configSpec>([\s\S]*?)<\/configSpec>[\s\S]*?<\/importSpec>/.exec(specXml)?.[1];
  if (!configInner) throw new Error("CreateImportSpec no devolvio importSpec");

  const taskXml = await soapCall(tenant,
    `<CreateVM_Task>` +
    `<_this type="Folder">${opts.folderId}</_this>` +
    `<config>${configInner}</config>` +
    `<pool type="ResourcePool">${opts.resourcePoolId}</pool>` +
    (opts.hostId ? `<host type="HostSystem">${opts.hostId}</host>` : "") +
    `</CreateVM_Task>`);
  const taskId = /<returnval type="Task">([^<]+)</.exec(taskXml)?.[1];
  if (!taskId) throw new Error(`CreateVM_Task fallo: ${taskXml.slice(0, 200)}`);
  const { vmId, error, leaseId } = await soapTaskPoll(tenant, taskId);
  if (error) throw new Error(`Import fallo: ${error}`);
  if (vmId) return vmId;
  if (leaseId) {
    // Sin archivos que subir (OVF minimo): cerrar el lease y leer la VM propietaria.
    const li = await soapCall(tenant,
      `<RetrievePropertiesEx><_this type="PropertyCollector">propertyCollector</_this>` +
      `<specSet><propSet><type>HttpNfcLease</type><pathSet>info.entity</pathSet></propSet>` +
      `<objectSet><obj type="HttpNfcLease">${leaseId}</obj></objectSet></specSet><options/></RetrievePropertiesEx>`);
    const leasedVm = /type="VirtualMachine">([^<]+)</.exec(li)?.[1] ?? "";
    await soapCall(tenant, `<HttpNfcLeaseComplete><_this type="HttpNfcLease">${leaseId}</_this></HttpNfcLeaseComplete>`);
    if (leasedVm) return leasedVm;
  }
  // El task puede no exponer info.result: resolver la VM por nombre.
  const all = await viFetch<{ name: string; vm: string }[]>(tenant, "/api/vcenter/vm");
  const found = all.find((v) => v.name === opts.name)?.vm;
  if (found) return found;
  throw new Error("El import no devolvio la VM creada");
};

/** Extrae cpu/ram/os/nic/disk del descriptor OVF dentro del OVA staging. */
const readOvaHardware = async (uploadId: string): Promise<{ cpu: number; memMb: number; osDesc: string; hasNic: boolean; diskCapacityBytes: number }> => {
  const { execFile } = await import("child_process");
  const { mkdtemp, readdir, readFile, rm, stat } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const src = getOvaUploadPaths(uploadId).filePath;
  if (!(await stat(src).catch(() => null))?.isFile()) {
    return { cpu: 1, memMb: 512, osDesc: "otherGuest64", hasNic: true, diskCapacityBytes: 8 * 1024 ** 3 };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "ova-"));
  try {
    await new Promise<void>((res, rej) =>
      execFile("tar", ["-xf", src, "-C", dir], { timeout: 120_000 }, (e) => e ? rej(new Error(`OVA corrupto: ${e.message}`)) : res()));
    const files = await readdir(dir);
    const ovfName = files.find((f) => f.toLowerCase().endsWith(".ovf"));
    if (!ovfName) throw new Error("El OVA no contiene descriptor OVF");
    const ovf = await readFile(path.join(dir, ovfName), "utf8");
    const num = (re: RegExp) => { const m = re.exec(ovf); return m ? parseInt(m[1], 10) : undefined; };
    const cpu = num(/<rasd:ResourceType>3<\/rasd:ResourceType>[\s\S]{0,400}?<rasd:VirtualQuantity>(\d+)</) ?? 1;
    const memMb = num(/<rasd:ResourceType>4<\/rasd:ResourceType>[\s\S]{0,400}?<rasd:VirtualQuantity>(\d+)</) ?? 512;
    const osDesc = /<OperatingSystemSection[\s\S]*?<Description>([^<]*)<\/Description>/.exec(ovf)?.[1] ?? "otherGuest64";
    const hasNic = /<rasd:ResourceType>10<\/rasd:ResourceType>/.test(ovf);
    // DMTF: bytes = capacity x capacityAllocationUnits ("byte", "byte * 2^20", ...)
    const capRaw = num(/<Disk [^>]*ovf:capacity="(\d+)"/) ?? 0;
    const unitsStr = /ovf:capacityAllocationUnits="([^"]*)"/.exec(ovf)?.[1]?.trim() ?? "byte";
    const pow2 = /byte \* 2\^(\d+)/i.exec(unitsStr);
    const pow10 = /byte \* 10\^(\d+)/i.exec(unitsStr);
    let mult = 1;
    if (pow2) mult = 2 ** Number(pow2[1]);
    else if (pow10) mult = 10 ** Number(pow10[1]);
    const diskCapacityBytes = capRaw * mult || 8 * 1024 ** 3;
    return { cpu, memMb, osDesc, hasNic, diskCapacityBytes };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/** Import de OVA para vCenter: VM con hardware equivalente + disco/NIC por REST. */
export const importOvaVm = async (tenantId: string, payload: ImportOvaVmInput): Promise<{ vmId: string; pending: boolean }> => {
  const tenant = await getTenantById(tenantId);
  const existing = await listAllVms(tenant);
  if (existing.some((v) => v.name === payload.name)) {
    throw new Error(`Ya existe una VM con nombre ${payload.name}`);
  }

  // Recursos de placement: datastore montado en el host elegido (o mayor espacio),
  // folder "vm", resource pool y host. El datastore debe estar montado en el host
  // o el import falla con "Unable to access file".
  const dsList = payload.hostId
    ? await viFetch<{ datastore: string; name: string }[]>(tenant, `/api/vcenter/datastore?hosts=${payload.hostId}`).catch(() => [])
    : [];
  const datastores = await listAllDatastores(tenant);
  const dsFiltered = dsList.length ? datastores.filter((d) => dsList.some((m) => m.datastore === d.id)) : datastores;
  const ds = dsFiltered.find((d) => d.id === payload.storageDomainId)
    ?? dsFiltered.sort((a, b) => b.availableGB - a.availableGB)[0];
  if (!ds) throw new Error("El datastore solicitado no esta disponible en el host elegido");
  const folders = await viFetch<{ folder: string; name: string }[]>(tenant, "/api/vcenter/folder?type=VIRTUAL_MACHINE");
  const folder = (folders.find((f) => f.name === "vm") ?? folders[0])?.folder;
  if (!folder) throw new Error("No hay carpetas de VMs disponibles para importar");
  const clusterParam = payload.clusterId ? `?clusters=${payload.clusterId}` : "";
  const pools = await viFetch<{ resource_pool: string }[]>(tenant, `/api/vcenter/resource-pool${clusterParam}`);
  const pool = pools[0]?.resource_pool;
  if (!pool) throw new Error("No se encontro resource pool para el cluster");

  const hw = payload.uploadId
    ? await readOvaHardware(payload.uploadId).catch(() => ({ cpu: 1, memMb: 512, osDesc: "otherGuest64", hasNic: true, diskCapacityBytes: 8 * 1024 ** 3 }))
    : { cpu: 1, memMb: 512, osDesc: "otherGuest64", hasNic: true, diskCapacityBytes: 8 * 1024 ** 3 };

  // El datastore elegido puede estar montado pero NO escribible en el host
  // pedido (datastores locales: Local02 solo escribe en su dueno). Si el
  // CreateVM falla con CannotAccessFile, reintentar con los demas hosts.
  const hostCandidates: (string | undefined)[] = payload.hostId ? [payload.hostId] : [];
  const allHosts = await viFetch<{ host: string; connection_state: string }[]>(tenant, "/api/vcenter/host").catch(() => []);
  for (const h of allHosts) {
    if (h.connection_state === "CONNECTED" && !hostCandidates.includes(h.host)) hostCandidates.push(h.host);
  }
  if (!hostCandidates.length) hostCandidates.push(undefined);

  let vmId: string | null = null;
  let lastError: unknown = null;
  for (const candidate of hostCandidates) {
    try {
      vmId = await soapImportCreateVm(tenant, {
        name: payload.name, cpu: hw.cpu, memMb: hw.memMb, osDesc: hw.osDesc,
        datastoreId: ds.id, resourcePoolId: pool, folderId: folder, hostId: candidate,
        networkId: (await fetchNetworks(tenantId)).find((n) => n.name === "VM Network")?.id,
      });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (!/Unable to access file/i.test((e as Error).message)) throw e;
    }
  }
  if (!vmId) throw lastError instanceof Error ? lastError : new Error("Import fallo");
  await applyTenantTag(tenant, vmId);

  if (hw.diskCapacityBytes > 0) {
    // La VM importada no trae controlador SCSI: agregarlo por SOAP antes del disco.
    await soapCall(tenant, reconfigureVm(vmId,
      `<operation>add</operation>` +
      `<device xsi:type="VirtualLsiLogicSASController">` +
      `<key>-101</key><busNumber>0</busNumber><sharedBus>noSharing</sharedBus>` +
      `</device>`));
    let attached = false;
    for (let i = 0; i < 5 && !attached; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      attached = await viFetch(tenant, `/api/vcenter/vm/${vmId}/hardware/disk`, {
        method: "POST",
        body: JSON.stringify({ new_vmdk: { capacity: hw.diskCapacityBytes } }),
      }).then(() => true).catch(() => false);
    }
    if (!attached) throw new Error(`VM importada (${vmId}) pero fallo el attach del disco`);
  }
  if (hw.hasNic) {
    const networks = await fetchNetworks(tenantId);
    const networkId = networks.find((n) => n.name === "VM Network")?.id ?? networks[0]?.id;
    if (networkId) {
      await addNicToVm(tenantId, vmId, { vnicProfileId: networkId })
        .catch((e) => { throw new Error(`VM importada (${vmId}) pero fallo la NIC: ${e.message}`); });
    }
  }
  return { vmId, pending: false };
};

/* ── ISOs sobre datastore (vCenter) ─────────────────────────────────────
 *  El build del lab no expone Content Library: las ISOs viven como archivos
 *  en <datastore>/iso/ y se gestionan por el canal de archivos del datastore
 *  (PUT/GET /folder con cookie de sesion SOAP), igual que el browser del
 *  vSphere Client. El montaje es un ReconfigVM del VirtualCdrom. */

const datastoreIsoDir = async (tenant: TenantConfig): Promise<{ dsName: string; dcName: string } | null> => {
  const ds = (await listAllDatastores(tenant))[0];
  if (!ds) return null;
  const dcs = await viFetch<{ name: string }[]>(tenant, "/api/vcenter/datacenter").catch(() => []);
  return { dsName: ds.name, dcName: dcs[0]?.name ?? "" };
};

/** Lista las ISOs disponibles en el datastore del tenant. */
export const fetchIsos = async (tenantId: string): Promise<{ id: string; name: string }[]> => {
  const tenant = await getTenantById(tenantId);
  const dir = await datastoreIsoDir(tenant);
  if (!dir) return [];
  const cookie = await soapLogin(tenant);
  const res = await undiciFetch(
    `${tenant.baseUrl}/folder/iso/?dsName=${encodeURIComponent(dir.dsName)}&dcPath=${encodeURIComponent(dir.dcName)}`,
    { headers: { Cookie: cookie }, dispatcher: getDispatcher(tenant) as never },
  );
  if (!res.ok) return [];
  const html = await res.text();
  // hrefs tipo /folder/iso/test.iso?dcPath=...&dsName=... : capturar solo el nombre base.
  const names = [...html.matchAll(/href="[^"]*\/([^"/?]+\.iso)[^"]*"/gi)]
    .map((m) => decodeURIComponent(m[1]))
    .filter(Boolean);
  return [...new Set(names)].map((n) => ({ id: `[${dir.dsName}] iso/${n}`, name: n }));
};

/** Sube un archivo local al datastore como <ds>/iso/<fileName>. Devuelve el path vSphere. */
export const putIsoToDatastore = async (
  tenant: TenantConfig, datastoreName: string, fileName: string, filePath: string,
): Promise<string> => {
  const dcs = await viFetch<{ name: string }[]>(tenant, "/api/vcenter/datacenter").catch(() => []);
  const dcName = dcs[0]?.name ?? "";
  const cookie = await soapLogin(tenant);
  const { readFile } = await import("fs/promises");
  const body = await readFile(filePath);
  const url = `${tenant.baseUrl}/folder/iso/${encodeURIComponent(fileName)}` +
    `?dsName=${encodeURIComponent(datastoreName)}&dcPath=${encodeURIComponent(dcName)}`;
  const res = await undiciFetch(url, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
    body: new Uint8Array(body),
    dispatcher: getDispatcher(tenant) as never,
  });
  if (res.status >= 400) {
    throw new Error(`Subida de ISO al datastore fallo (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return `[${datastoreName}] iso/${fileName}`;
};

const vmDevicesXml = async (tenant: TenantConfig, vmId: string): Promise<string> =>
  soapCall(tenant,
    `<RetrievePropertiesEx><_this type="PropertyCollector">propertyCollector</_this>` +
    `<specSet><propSet><type>VirtualMachine</type><pathSet>config.hardware.device</pathSet></propSet>` +
    `<objectSet><obj type="VirtualMachine">${vmId}</obj></objectSet></specSet><options/></RetrievePropertiesEx>`);

const cdromConnectable = (on: boolean) =>
  // Orden exigido por el parser SOAP de este build: startConnected, allowGuestControl, connected.
  `<connectable><startConnected>${on}</startConnected><allowGuestControl>true</allowGuestControl><connected>${on}</connected></connectable>`;

/** ISO montada en la VM (path del backing) o null. */
export const fetchCurrentIso = async (tenantId: string, vmId: string): Promise<string | null> => {
  const tenant = await getTenantById(tenantId);
  const xml = await vmDevicesXml(tenant, vmId);
  for (const block of xml.match(/<VirtualDevice xsi:type="VirtualCdrom">[\s\S]*?<\/VirtualDevice>/g) ?? []) {
    const file = /<fileName>([^<]+)<\/fileName>/.exec(block)?.[1];
    if (file) return file;
  }
  return null;
};

/** Monta una ISO (path "[DS] iso/x.iso") en el primer CDROM; lo crea si no existe. */
export const mountIsoToVm = async (tenantId: string, vmId: string, isoPath: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const xml = await vmDevicesXml(tenant, vmId);
  const cdromBlock = (xml.match(/<VirtualDevice xsi:type="VirtualCdrom">[\s\S]*?<\/VirtualDevice>/g) ?? [])[0] ?? "";
  const cdromKey = /<key>(-?\d+)<\/key>/.exec(cdromBlock)?.[1];
  let changes: string;
  if (cdromKey) {
    changes = `<deviceChange><operation>edit</operation>` +
      `<device xsi:type="VirtualCdrom"><key>${cdromKey}</key>` +
      `<backing xsi:type="VirtualCdromIsoBackingInfo"><fileName>${escapeXml(isoPath)}</fileName></backing>` +
      cdromConnectable(true) + `</device></deviceChange>`;
  } else {
    const ideBlock = (xml.match(/<VirtualDevice xsi:type="VirtualIDEController">[\s\S]*?<\/VirtualDevice>/g) ?? [])[0] ?? "";
    const ideKey = /<key>(\d+)<\/key>/.exec(ideBlock)?.[1];
    let ideAdd = "";
    const controllerKey = ideKey ?? "-43";
    if (!ideKey) {
      // VMs "blank" sin IDE: agregar el controlador en el mismo cambio,
      // con el CDROM referenciando la key temporal.
      ideAdd = `<deviceChange><operation>add</operation>` +
        `<device xsi:type="VirtualIDEController"><key>-43</key><busNumber>0</busNumber></device></deviceChange>`;
    }
    changes = ideAdd +
      `<deviceChange><operation>add</operation>` +
      `<device xsi:type="VirtualCdrom"><key>-42</key>` +
      `<backing xsi:type="VirtualCdromIsoBackingInfo"><fileName>${escapeXml(isoPath)}</fileName></backing>` +
      cdromConnectable(true) +
      `<controllerKey>${controllerKey}</controllerKey><unitNumber>0</unitNumber></device></deviceChange>`;
  }
  await soapCall(tenant, reconfigureSpec(vmId, changes));
};

/** Accion "iniciar desde CD": boot order CD-primero (best effort) y encendido.
 *  En VMs con disco vacio el BIOS arranca el CD de todas formas, por lo que el
 *  bootOrder es optimistico: si el parser SOAP lo rechaza, se enciende igual. */
export const runOnceFromCd = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  try {
    const xml = await vmDevicesXml(tenant, vmId);
    const diskKey = /<VirtualDevice xsi:type="VirtualDisk">[\s\S]*?<key>(\d+)<\/key>/.exec(xml)?.[1];
    const diskBoot = diskKey
      ? `<devices xsi:type="VirtualMachineBootOptionsBootableDiskDevice"><deviceKey>${diskKey}</deviceKey></devices>`
      : "";
    await soapCall(tenant, reconfigureSpec(vmId,
      `<bootOptions><bootOrder>` +
      `<devices xsi:type="VirtualMachineBootOptionsBootableCdromDevice"/>` +
      diskBoot +
      `</bootOrder></bootOptions>`));
  } catch { /* best effort */ }
  await viFetch(tenant, `/api/vcenter/vm/${vmId}/power?action=start`, { method: "POST" });
};

/** Expulsa la ISO: en este build el edit del backing se ignora, se remueve el CDROM
 *  (el proximo montaje lo vuelve a crear). */
export const unmountIsoFromVm = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const xml = await vmDevicesXml(tenant, vmId);
  const cdromBlock = (xml.match(/<VirtualDevice xsi:type="VirtualCdrom">[\s\S]*?<\/VirtualDevice>/g) ?? [])[0] ?? "";
  const cdromKey = /<key>(-?\d+)<\/key>/.exec(cdromBlock)?.[1];
  if (!cdromKey) return;
  await soapCall(tenant, reconfigureVm(vmId,
    `<operation>remove</operation>` +
    `<device xsi:type="VirtualCdrom"><key>${cdromKey}</key></device>`));
};

type CloneVmProgress = (stage: string, progress: number) => void | Promise<void>;
export type CloneVmStage =
  | "submitting" | "waiting" | "tagging" | "stopping" | "networking" | "disks";

/**
 * Clone. 9.x: REST POST /api/vcenter/vm/{vm}/action/clone; 7/8: vAPI
 * com.vmware.vcenter.vm.clone. Paridad OLVM: clona, espera, taggea y apaga.
 * TODO(lab): confirmar shape del clone REST en 9.x.
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
  const newVmId = await runCapability<string | { vm?: string }>(
    tenant,
    "vm.clone",
    {
      api: {
        method: "POST",
        path: `/api/vcenter/vm/${sourceVmId}/action/clone`,
        build: () => ({ spec: { name: cloneName } }),
      },
      vapi: {
        service: "vcenter.vm",
        action: "clone",
        build: () => ({ source: sourceVmId, spec: { name: cloneName } }),
      },
    },
    { source: sourceVmId, spec: { name: cloneName } },
  ).then((r) => {
    const id = typeof r === "string" ? r : r?.vm;
    if (!id) throw new Error("Clone no devolvio vm id");
    return id;
  });

  await onProgress?.("waiting", 40);
  // Espera: la VM clonada aparece en /api/vcenter/vm
  for (let i = 0; i < 60; i++) {
    const all = await listAllVms(tenant);
    if (all.some((v) => v.vm === newVmId)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  await onProgress?.("tagging", 60);
  await applyTenantTag(tenant, newVmId);

  await onProgress?.("stopping", 80);
  await doPower(tenant, newVmId, "stop").catch(() => undefined);

  await onProgress?.("completed", 100);
  return { vmId: newVmId };
};

type UpdateVmInput = { memoryMB?: number; cpuCores?: number; sockets?: number };

/** CPU/RAM. 9.x: REST action endpoints; 7/8: vAPI hardware.update.
 *  TODO(lab): confirmar shapes exactos en 9.x. */
export const updateVmResources = async (
  tenantId: string,
  vmId: string,
  payload: UpdateVmInput,
) => {
  await enforceVmTagPolicy(tenantId, vmId);
  const tenant = await getTenantById(tenantId);

  type VmDetail = {
    power_state?: string;
    cpu?: { count?: number; hot_add_enabled?: boolean };
    memory?: { size_MiB?: number; hot_add_enabled?: boolean };
  };
  const detail = await viFetch<VmDetail>(tenant, `/api/vcenter/vm/${vmId}`);
  const wasOn = detail?.power_state === "POWERED_ON";
  const hotReady = Boolean(detail?.cpu?.hot_add_enabled && detail?.memory?.hot_add_enabled);
  const increasing =
    (!payload.cpuCores || payload.cpuCores >= (detail?.cpu?.count ?? 0)) &&
    (!payload.memoryMB || payload.memoryMB >= (detail?.memory?.size_MiB ?? 0));

  const waitPower = async (desired: string, tries = 45) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const d = await viFetch<VmDetail>(tenant, `/api/vcenter/vm/${vmId}`).catch(() => null);
      if (d?.power_state === desired) return;
    }
    throw new Error(`La VM no alcanzó el estado ${desired} a tiempo`);
  };
  const enableHotAdd = async () => {
    await soapCall(tenant, reconfigureSpec(vmId,
      `<memoryHotAddEnabled>true</memoryHotAddEnabled>` +
      `<cpuHotAddEnabled>true</cpuHotAddEnabled>`));
  };

  // VMware aplica CPU/RAM en caliente cuando la VM tiene hot-add habilitado.
  // Si aun no lo tiene: se habilita con un ciclo de energia UNA sola vez;
  // a partir de ahi los cambios son en vivo.
  if (wasOn && hotReady && increasing) {
    try {
      await applyResourceChanges(tenant, vmId, payload);
      return;
    } catch {
      // vCenter puede rechazar (p. ej. reducir RAM en caliente): ciclo completo
    }
  }

  if (wasOn) {
    await doPower(tenant, vmId, "stop");
    await waitPower("POWERED_OFF");
  }

  try {
    await enableHotAdd().catch(() => undefined);
    await applyResourceChanges(tenant, vmId, payload);
  } catch (error) {
    if (wasOn) {
      await doPower(tenant, vmId, "start").catch(() => undefined);
    }
    throw error;
  }
  if (wasOn) {
    await doPower(tenant, vmId, "start");
    await waitPower("POWERED_ON");
  }
};

const applyResourceChanges = async (
  tenant: TenantConfig,
  vmId: string,
  payload: UpdateVmInput,
) => {
  // Este build no expone REST/vAPI de hardware: CPU/RAM van por SOAP.
  // Nota de laboratorio: en un solo spec, memoryMB+numCPUs juntos rompen el
  // parser (orden estricto del ConfigSpec), asi que van en llamadas separadas.
  if (payload.cpuCores) {
    const cores = Math.max(1, Math.round(payload.cpuCores));
    const sockets = payload.sockets && payload.sockets > 0 ? Math.round(payload.sockets) : 0;
    const coresPerSocket = sockets > 0 && cores % sockets === 0 ? cores / sockets : null;
    const spec = `<numCPUs>${cores}</numCPUs>` +
      (coresPerSocket ? `<numCoresPerSocket>${coresPerSocket}</numCoresPerSocket>` : "");
    await soapCall(tenant, reconfigureSpec(vmId, spec));
  }
  if (payload.memoryMB) {
    await soapCall(tenant, reconfigureSpec(vmId, `<memoryMB>${Math.round(payload.memoryMB)}</memoryMB>`));
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
