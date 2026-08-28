import https from "https";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { getTenantById, type TenantConfig } from "./config";

type RawValue = {
  datum?: number | string;
  value?: number | string;
};

type RawStatistic = {
  name?: string;
  id?: string;
  kind?: string;
  values?: { value?: RawValue[] } | RawValue[];
};

type RawVm = {
  id?: string;
  uuid?: string;
  name?: string;
  status?: { state?: string } | string;
  cluster?: { name?: string; id?: string };
  template?: { name?: string; id?: string };
  host?: { name?: string; id?: string };
  memory?: number | string;
  cpu?: {
    topology?: {
      cores?: number | string;
      sockets?: number | string;
      threads?: number | string;
      vcpu?: Record<string, unknown>;
    };
  };
  statistics?: { statistic?: RawStatistic[] } | RawStatistic[];
  tag?: RawTag[] | { tag?: RawTag[] };
  tags?: RawTag[] | { tag?: RawTag[] };
  os?: { type?: string };
  guest_info?: { fqdn?: string; ips?: unknown };
};

type RawConsole = {
  id?: string;
  protocol?: string;
  address?: string;
  port?: number | string;
  tls_port?: number | string;
};

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
  status: string;
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
  protocol: string;
  host?: string;
  port?: number | string;
  tlsPort?: number | string;
  consoleId?: string;
  ticket?: string;
  websocket?: { wsUrl?: string; wsPath?: string; engineHost?: string };
  proxyTicket?: { value: string; host?: string; port?: number; sslTarget?: boolean };
};

type RawTag = {
  id?: string;
  name?: string;
};

type OlvmFetchInit = RequestInit & {
  allowInsecure?: boolean;
  dispatcher?: UndiciAgent;
};

const dispatcherCache = new Map<string, UndiciAgent>();

// Use undici dispatcher to honor custom CA and allowInsecure; node's global fetch
// ignores the legacy `agent` option for custom TLS, so we manage per-tenant
// dispatchers here.
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

// Invalida el caché de dispatchers TLS (tras crear/editar/eliminar conexiones).
export const invalidateDispatcherCache = (tenantId?: string) => {
  if (tenantId) dispatcherCache.delete(tenantId);
  else dispatcherCache.clear();
  // Las conexiones cambiaron: limpiar también el caché de nombres de hosts y tokens SSO.
  if (tenantId) hostNameCache.delete(tenantId);
  else hostNameCache.clear();
  ssoTokenCache.clear();
};

// Cache de nombres de hosts por tenant (id -> name). oVirt no permite
// follow=host sobre el listado de VMs (falla con VMs apagadas), se resuelve
// vía lookup contra /hosts.
const hostNameCache = new Map<string, Map<string, string>>();
const getHostNameMap = async (
  tenant: TenantConfig,
): Promise<Map<string, string>> => {
  const cached = hostNameCache.get(tenant.id);
  if (cached) return cached;
  const map = new Map<string, string>();
  try {
    const data = (await olvmFetch(
      tenant,
      withJsonFormat("/hosts"),
    )) as unknown;
    const list = Array.isArray(data)
      ? data
      : (data && typeof data === "object" && "host" in data
          ? (data as { host?: unknown[] }).host
          : []) ?? [];
    for (const h of list) {
      const host = h as { id?: string; name?: string };
      if (host.id && host.name) map.set(host.id, host.name);
    }
  } catch {
    // best-effort
  }
  hostNameCache.set(tenant.id, map);
  return map;
};

export type ConnectionTestResult = {
  ok: boolean;
  status: number;
  detail: string;
};

// ── SSO OAuth tokens ── OLVM 4.5 con internal SSO (Keycloak) rechaza Basic en /api;
// hay que obtener un token vía /sso/oauth/token y usar "Authorization: Bearer".

type SsoTokenEntry = { token: string; expiresAt: number };
const ssoTokenCache = new Map<string, SsoTokenEntry>();

export const invalidateSsoTokenCache = () => {
  ssoTokenCache.clear();
};

const decodeJwtExp = (token: string): number | null => {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64").toString("utf8"),
    ) as { exp?: unknown };
    const exp = Number(payload.exp);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

type SsoConnection = {
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  allowInsecure?: boolean;
  caCert?: Buffer | string | null;
};

const ssoEndpointFor = (baseUrl: string) =>
  `${baseUrl.replace(/\/api\/?$/i, "").replace(/\/$/, "")}/sso/oauth/token`;

const acquireSsoToken = async (conn: SsoConnection): Promise<string | null> => {
  if (!conn.username || !conn.password) return null;
  const ca = conn.caCert
    ? typeof conn.caCert === "string"
      ? conn.caCert
      : conn.caCert.toString()
    : undefined;
  const dispatcher = new UndiciAgent({
    connect: conn.allowInsecure
      ? { rejectUnauthorized: false }
      : ca
        ? { ca }
        : undefined,
  });
  try {
    const body = new URLSearchParams({
      grant_type: "password",
      scope: "ovirt-app-api",
      username: conn.username,
      password: conn.password,
    }).toString();
    const res = await undiciFetch(ssoEndpointFor(conn.baseUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      dispatcher,
    } as any);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    const token = data?.access_token;
    if (!token) return null;
    const expiresAt = decodeJwtExp(token)
      ?? (data?.expires_in
        ? Date.now() + Number(data.expires_in) * 1000
        : Date.now() + 50 * 60 * 1000);
    ssoTokenCache.set(`${conn.baseUrl}|${conn.username}`, { token, expiresAt });
    return token;
  } catch {
    return null;
  }
};

const getSsoToken = async (conn: SsoConnection): Promise<string | null> => {
  const cached = ssoTokenCache.get(`${conn.baseUrl}|${conn.username}`);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  return acquireSsoToken(conn);
};

// Prueba una conexión (guardada o no) contra el engine OLVM.
export const testConnection = async (input: {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  caCert?: Buffer | string;
}): Promise<ConnectionTestResult> => {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const ca = input.caCert
    ? typeof input.caCert === "string"
      ? input.caCert
      : input.caCert.toString()
    : undefined;
  const dispatcher = new UndiciAgent({
    connect: input.allowInsecure
      ? { rejectUnauthorized: false }
      : ca
        ? { ca }
        : undefined,
  });

  const attempt = async (auth: string) =>
    undiciFetch(`${baseUrl}/vms?max=1`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: auth,
      },
      dispatcher,
    } as any);

  // Orden de intentos: token estático → token SSO (usuario+password) → Basic.
  const auths: string[] = [];
  if (input.token) auths.push(`Bearer ${input.token.trim()}`);
  if (input.username && input.password) {
    const sso = await getSsoToken(input);
    if (sso) auths.push(`Bearer ${sso}`);
    auths.push(
      `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf-8").toString("base64")}`,
    );
  }

  try {
    for (const auth of auths) {
      const res = await attempt(auth);
      if (res.status === 200) return { ok: true, status: 200, detail: "Conexión exitosa" };
      if (res.status !== 401) {
        return {
          ok: false,
          status: res.status,
          detail: `Respuesta inesperada (HTTP ${res.status})`,
        };
      }
    }
    return { ok: false, status: 401, detail: "Credenciales inválidas" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: `No se pudo conectar: ${(error as Error).message}`,
    };
  }
};

const buildHeaders = (tenant: TenantConfig, headers?: HeadersInit, authOverride?: string) => {
  let authHeader: string;
  if (authOverride) {
    authHeader = authOverride;
  } else if (tenant.token) {
    authHeader = `Bearer ${tenant.token}`;
  } else {
    const credentials = `${tenant.username}:${tenant.password}`;
    const auth = Buffer.from(credentials, "utf-8").toString("base64");
    authHeader = `Basic ${auth}`;
  }

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader,
    ...headers,
  };
};

const olvmFetch = async (
  tenant: TenantConfig,
  path: string,
  init?: OlvmFetchInit,
) => {
  const url = path.startsWith("http")
    ? path
    : `${tenant.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const doFetch = (auth?: string) =>
    undiciFetch(
      url,
      {
        ...init,
        cache: "no-store",
        headers: buildHeaders(tenant, init?.headers, auth),
        dispatcher: getDispatcher(tenant),
      } as any,
    );

  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    // Con usuario+password se intenta primero token SSO (requerido por OLVM 4.5
    // con internal SSO); si no está disponible cae a Basic (compatibilidad).
    let ssoToken: string | null = null;
    if (!tenant.token && tenant.username && tenant.password) {
      ssoToken = await getSsoToken(tenant);
    }
    response = await doFetch(ssoToken ? `Bearer ${ssoToken}` : undefined);
    if (response.status === 401 && ssoToken) {
      ssoTokenCache.delete(`${tenant.baseUrl}|${tenant.username}`);
      const fresh = await acquireSsoToken(tenant);
      if (fresh) response = await doFetch(`Bearer ${fresh}`);
    }
  } catch (error) {
    throw new Error(
      `No se pudo conectar con OLVM (${tenant.baseUrl}): ${(error as Error).message}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OLVM request failed (${response.status} ${response.statusText}): ${detail}`,
    );
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isJson = contentType.includes("application/json");
  const isXmlOrHtml =
    contentType.includes("xml") || contentType.includes("html");

  if (isJson) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse OLVM response: ${(error as Error).message}`);
    }
  }

  if (isXmlOrHtml) {
    // Some OLVM actions respond with XML/HTML; upstream callers may ignore the body.
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const pickStatisticValue = (stat: RawStatistic) => {
  if (!stat?.values) return undefined;
  const values = Array.isArray((stat.values as { value?: RawValue[] })?.value)
    ? (stat.values as { value?: RawValue[] }).value
    : (stat.values as RawValue[]);
  const last = values?.[values.length - 1];
  return Number(last?.datum ?? last?.value ?? last);
};

const mapStatistics = (
  statistics?: { statistic?: RawStatistic[] } | RawStatistic[],
  totalMemoryBytes?: number,
): VmMetric => {
  const statsArray = Array.isArray((statistics as { statistic?: RawStatistic[] })?.statistic)
    ? (statistics as { statistic?: RawStatistic[] }).statistic ?? []
    : Array.isArray(statistics)
      ? (statistics as RawStatistic[])
      : [];

  const lookup = (name: string) => {
    const stat = statsArray.find(
      (s) => s.name === name || s.id === name || s.kind === name,
    );
    return stat ? pickStatisticValue(stat) : undefined;
  };

  const cpuPercent =
    lookup("cpu.current.guest") ??
    lookup("cpu_usage") ??
    lookup("cpu.current.total") ??
    lookup("cpu.usage") ??
    lookup("usage.cpu");
  const memoryPercentStat =
    lookup("memory.usage") ??
    lookup("memory_usage") ??
    lookup("memory.used.percent") ??
    lookup("usage.memory") ??
    lookup("memory.utilization") ??
    lookup("usage.memory.percent");
  const memoryUsed =
    lookup("memory.used") ?? lookup("memory.used.bytes") ?? lookup("used.memory");

  let memoryPercent = memoryPercentStat;
  if (!memoryPercent && memoryUsed && totalMemoryBytes) {
    let usedBytes = memoryUsed;
    let percent = (usedBytes / totalMemoryBytes) * 100;
    if (percent < 0.5 && memoryUsed < 10_000) {
      // Some deployments expose memory.used en MB; if ratio es casi cero, reintenta en bytes.
      usedBytes = memoryUsed * 1024 * 1024;
      percent = (usedBytes / totalMemoryBytes) * 100;
    }
    memoryPercent = Math.min(100, Math.max(0, percent));
  }
  const diskReadBytes = lookup("disk.read.bytes") ?? lookup("disks.usage");
  const diskWriteBytes = lookup("disk.write.bytes");
  const networkBytes =
    (lookup("net.received.bytes") ?? 0) +
    (lookup("net.transmitted.bytes") ?? 0) ||
    lookup("network.current.total") ||
    undefined;

  return {
    cpuPercent,
    memoryPercent,
    diskReadBytes,
    diskWriteBytes,
    networkBytes: networkBytes || undefined,
  };
};

const normalizeVm = (
  vm: RawVm,
  hostMap?: Map<string, string>,
): VmSummary => {
  const cpuTopology = vm.cpu?.topology ?? {};
  const topoAny = cpuTopology as Record<string, unknown>;
  const sockets = Number(topoAny.sockets ?? topoAny["@sockets"]);
  const cores = Number(topoAny.cores ?? topoAny["@cores"]);
  const threads = Number(topoAny.threads ?? topoAny["@threads"]);
  const vcpuCount = Number(
    (cpuTopology as { vcpu?: { "@count"?: number; count?: number } })?.vcpu?.[
      "@count"
    ] ??
      (cpuTopology as { vcpu?: { "@count"?: number; count?: number } })?.vcpu
        ?.count ??
      (cpuTopology as { vcpu?: number })?.vcpu,
  );
  const totalCores = (cores || 1) * (sockets || 1) * (threads || 1);

  return {
    id: vm.id ?? vm.uuid ?? vm.name ?? "",
    name: vm.name ?? "VM",
    status:
      typeof vm.status === "string"
        ? vm.status
        : vm.status?.state ?? "unknown",
    cluster: vm.cluster?.name ?? vm.cluster?.id,
    template: vm.template?.name ?? vm.template?.id,
    host: vm.host?.name ?? hostMap?.get(vm.host?.id ?? "") ?? vm.host?.id,
    os: humanizeOs(vm.os?.type),
    ip: extractGuestIps(vm.guest_info?.ips),
    tags: parseTagNames(vm),
    memoryMB: vm.memory ? Math.round(Number(vm.memory) / 1024 / 1024) : undefined,
    cpuCores: vcpuCount || (cores || sockets || threads ? totalCores : undefined),
    sockets,
    metrics: mapStatistics(
      vm.statistics,
      vm.memory ? Number(vm.memory) : undefined,
    ),
  };
};

const withJsonFormat = (path: string) => {
  const hasQuery = path.includes("?");
  const hasFormat = /[?&]format=/i.test(path);
  if (hasFormat) return path;
  return `${path}${hasQuery ? "&" : "?"}format=json`;
};

// Extrae las IPs reportadas por el guest agent (oVirt guest_info.ips).
const extractGuestIps = (ips: unknown): string | undefined => {
  let list: { address?: string; type?: string }[] = [];
  if (Array.isArray(ips)) list = ips;
  else if (ips && typeof ips === "object") {
    const ipField = (ips as { ip?: unknown }).ip;
    if (Array.isArray(ipField)) list = ipField as { address?: string }[];
    else if (ipField) list = [ipField as { address?: string }];
  }
  const addrs = list
    .map((i) => i?.address)
    .filter(
      (a): a is string =>
        typeof a === "string" &&
        a.length > 0 &&
        !a.startsWith("127.") &&
        a !== "::1",
    );
  return addrs.length ? addrs.join(", ") : undefined;
};

// Convierte el tipo de OS de oVirt (rhel_8x64, ubuntu_22, windows_11...) a nombre legible.
const humanizeOs = (type?: string): string | undefined => {
  if (!type) return undefined;
  const t = type.toLowerCase();
  const ver = (type.match(/\d+/)?.[0] ?? "").trim();
  const families: { test: (s: string) => boolean; label: string }[] = [
    { test: (s) => s.startsWith("rhel"), label: `Red Hat Enterprise Linux${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("centos"), label: `CentOS${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("rocky"), label: `Rocky Linux${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("almalinux"), label: `AlmaLinux${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("oracle"), label: `Oracle Linux${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("ubuntu"), label: `Ubuntu${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("debian"), label: `Debian${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("fedora"), label: `Fedora${ver ? " " + ver : ""}` },
    { test: (s) => s.startsWith("sles") || s.startsWith("suse"), label: `SUSE Linux${ver ? " " + ver : ""}` },
  ];
  for (const f of families) if (f.test(t)) return f.label;
  if (t.startsWith("windows") || t.startsWith("win")) {
    if (!ver) return "Windows";
    return Number(ver) >= 2016 ? `Windows Server ${ver}` : `Windows ${ver}`;
  }
  if (t === "other_linux" || t === "linux") return "Linux (otro)";
  if (t === "other") return "Otro";
  return type;
};

const parseGraphicsConsoles = (data: unknown): RawConsole[] => {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!root) return [];
  const direct = root.graphics_console ?? root.console ?? root.graphics_console_list;
  const consoles =
    Array.isArray(direct) && direct.length > 0
      ? (direct as RawConsole[])
      : Array.isArray(root.graphics_consoles)
        ? (root.graphics_consoles as RawConsole[])
        : Array.isArray((root.graphics_consoles as { graphics_console?: RawConsole[] })?.graphics_console)
          ? ((root.graphics_consoles as { graphics_console?: RawConsole[] }).graphics_console ??
            [])
          : Array.isArray((root as { graphics_console?: RawConsole[] }).graphics_console)
            ? ((root as { graphics_console?: RawConsole[] }).graphics_console ?? [])
            : [];
  return consoles;
};

const parseTagNames = (data: unknown): string[] => {
  const root =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!root) return [];

  const vmLevel =
    root.vm && typeof root.vm === "object"
      ? (root.vm as Record<string, unknown>)
      : root;

  const candidates: RawTag[] = [];
  const pushMany = (value: unknown) => {
    if (Array.isArray(value)) {
      candidates.push(...(value as RawTag[]));
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.tag)) {
        candidates.push(...(obj.tag as RawTag[]));
      }
    }
  };

  pushMany(vmLevel.tag);
  pushMany(vmLevel.tags);
  pushMany(root.tag);
  pushMany(root.tags);

  return Array.from(
    new Set(
      candidates
        .map((tag) => (tag?.name ?? "").toString().trim())
        .filter(Boolean),
    ),
  );
};

export const vmMatchesTenantTag = (vm: RawVm, expectedTag?: string) => {
  const normalizedExpected = expectedTag?.trim().toLowerCase();
  if (!normalizedExpected) return false;
  return parseTagNames(vm).some((tag) => tag.toLowerCase() === normalizedExpected);
};

export const enforceVmTagPolicy = async (tenantId: string, vmId: string) => {
  const tenant = await getTenantById(tenantId);
  const expectedTag = tenant.tag?.trim();
  if (!expectedTag) {
    throw new Error(`Forbidden: tenant ${tenantId} no tiene un tag OLVM configurado`);
  }

  const payload = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}?follow=tags`),
  );
  const tagNames = parseTagNames(payload);
  const expected = expectedTag.toLowerCase();
  const hasTag = tagNames.some((tag) => tag.toLowerCase() === expected);

  if (!hasTag) {
    throw new Error(
      `Forbidden: VM ${vmId} no tiene tag del tenant (${expectedTag})`,
    );
  }
};

const pickConsole = (
  consoles: RawConsole[],
  preferred: "spice" | "vnc" = "spice",
): RawConsole | undefined => {
  const normalized = consoles
    .map((c) => ({
      id: c.id ?? "",
      protocol: (c.protocol ?? "").toString().toLowerCase(),
      address: c.address,
      port: c.port,
      tls_port: c.tls_port,
    }))
    .filter((c) => c.id && c.protocol);

  const preferredConsole = normalized.find((c) => c.protocol === preferred);
  return preferredConsole ?? normalized[0];
};

type TicketInfo = { value: string; expirySeconds?: number };

const parseTicketValue = (payload: unknown): TicketInfo | undefined => {
  const root = payload && typeof payload === "object" ? (payload as Record<string, any>) : null;
  if (!root) return undefined;
  const value =
    root?.action?.ticket?.value ??
    root?.ticket?.value ??
    root?.value ??
    (typeof root?.action?.ticket === "string" ? root.action.ticket : undefined);

  if (!value || typeof value !== "string") return undefined;

  const expiry =
    root?.action?.ticket?.expiry ??
    root?.ticket?.expiry ??
    root?.expiry ??
    (typeof root?.action?.ticket === "object" ? (root.action.ticket as any)?.expiry : undefined);

  const expirySeconds = typeof expiry === "string" ? Number(expiry) : Number(expiry);

  return { value, expirySeconds: Number.isFinite(expirySeconds) ? expirySeconds : undefined };
};

type TicketCacheEntry = { value: string; expiresAt: number };
const ticketCache = new Map<string, TicketCacheEntry>();

const normalizeOlvmErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getFriendlyConsoleTicketError = (error: unknown) => {
  const message = normalizeOlvmErrorMessage(error);
  if (message.includes("Cannot set Virtual Machine Ticket because the VM is in Down status")) {
    return "La VM está apagada. Iníciala antes de abrir la consola embebida.";
  }
  return null;
};

const requestConsoleTicket = async (
  tenant: TenantConfig,
  vmId: string,
  consoleId: string,
) => {
  const cacheKey = `${tenant.id}:${vmId}:${consoleId}`;
  const now = Date.now();
  const cached = ticketCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 5_000) {
    return cached.value;
  }

  const ticketPath = `/vms/${vmId}/graphicsconsoles/${consoleId}/ticket`;
  const ticketPayloads = [
    { ticket: { expiry: 120 } },
  ];

  let lastError: unknown;
  for (const payload of ticketPayloads) {
    try {
      const response = await olvmFetch(tenant, ticketPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const parsed = parseTicketValue(response);
      if (parsed?.value) {
        const expiryMs = (parsed.expirySeconds ?? 120) * 1000;
        ticketCache.set(cacheKey, { value: parsed.value, expiresAt: now + expiryMs });
        return parsed.value;
      }
      lastError = new Error("Ticket vacío");
    } catch (err) {
      const friendlyError = getFriendlyConsoleTicketError(err);
      if (friendlyError) {
        throw new Error(friendlyError);
      }
      lastError = err;
    }
  }

  const detail = lastError ? ` Detalle: ${(lastError as Error).message}` : "";
  throw new Error(`No se pudo obtener ticket de consola desde OLVM.${detail}`);
};

const requestConsoleProxyTicket = async (
  tenant: TenantConfig,
  vmId: string,
  consoleId: string,
) => {
  const path = `/vms/${vmId}/graphicsconsoles/${consoleId}/proxyticket`;
  try {
    const response = await olvmFetch(tenant, path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const value =
      (response as any)?.proxy_ticket?.value ??
      (response as any)?.proxyticket ??
      (response as any)?.value;

    if (!value || typeof value !== "string") return undefined;

    let decodedHost: string | undefined;
    let decodedPort: number | undefined;
    let sslTarget: boolean | undefined;
    try {
      const decoded = Buffer.from(value, "base64").toString("utf-8");
      const json = JSON.parse(decoded);
      if (json?.data) {
        const dataStr = decodeURIComponent(json.data as string);
        const dataJson = JSON.parse(dataStr);
        decodedHost = dataJson?.host;
        const portNum = Number(dataJson?.port);
        decodedPort = Number.isFinite(portNum) ? portNum : undefined;
        sslTarget =
          dataJson?.ssl_target === true ||
          dataJson?.ssl_target === "true" ||
          dataJson?.ssl_target === 1;
      }
    } catch {
      // ignore parsing errors; fallback to raw value only
    }

    return { value, host: decodedHost, port: decodedPort, sslTarget };
  } catch {
    return undefined;
  }
};

const parseVirtViewerConnection = (
  vvContent: string,
): { host?: string; port?: number; tlsPort?: number; password?: string } => {
  const lines = vvContent.split("\n").map((l) => l.trim());
  const toNum = (v?: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const lookup = (key: string) =>
    lines
      .find((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}=`))
      ?.split("=")
      ?.slice(1)
      ?.join("=");

  return {
    host: lookup("host"),
    port: toNum(lookup("port")),
    tlsPort: toNum(lookup("tls-port")),
    password: lookup("password"),
  };
};

export const fetchVms = async (tenantId: string): Promise<VmSummary[]> => {
  const tenant = await getTenantById(tenantId);
  const expectedTag = tenant.tag?.trim();
  const data = (await olvmFetch(
    tenant,
    withJsonFormat("/vms?all_content=true&follow=statistics,tags,cluster,template"),
  )) as unknown;
  const hostMap = await getHostNameMap(tenant);
  const root =
    data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const filterByTenant = (vms: RawVm[]) =>
    vms.filter((vm) => vmMatchesTenantTag(vm, expectedTag));
  if (root && "vm" in root && Array.isArray((root as { vm?: unknown }).vm)) {
    return filterByTenant((root as { vm?: RawVm[] }).vm ?? []).map((v) => normalizeVm(v, hostMap));
  }
  const vmsField = root && "vms" in root ? (root as { vms?: unknown }).vms : null;
  if (Array.isArray(vmsField)) {
    return filterByTenant(vmsField as RawVm[]).map((v) => normalizeVm(v, hostMap));
  }
  const nested = vmsField && typeof vmsField === "object" ? vmsField : null;
  if (nested && "vm" in nested && Array.isArray((nested as { vm?: unknown }).vm)) {
    return filterByTenant((nested as { vm?: RawVm[] }).vm ?? []).map((v) => normalizeVm(v, hostMap));
  }
  return [];
};

// Lista TODAS las VMs sin filtrar por tag. Solo para detección interna de clones;
// los clones nacen sin tag y serían invisibles en la lista filtrada por tenant.
const fetchAllVmsUnfiltered = async (tenant: TenantConfig): Promise<RawVm[]> => {
  const data = (await olvmFetch(
    tenant,
    withJsonFormat("/vms?follow=tags"),
  )) as unknown;
  const root =
    data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (root && "vm" in root && Array.isArray((root as { vm?: unknown }).vm)) {
    return (root as { vm?: RawVm[] }).vm ?? [];
  }
  return [];
};

export const fetchVmById = async (
  tenantId: string,
  vmId: string,
): Promise<VmSummary> => {
  const tenant = await getTenantById(tenantId);
  const hostMap = await getHostNameMap(tenant);
  const data = (await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}?all_content=true&follow=statistics,cluster,template,tags`),
  )) as RawVm;
  return normalizeVm(data, hostMap);
};

export type VmDiskInfo = {
  name?: string;
  sizeGB: number;
  usedGB?: number;
  type?: string;
  interface?: string;
};

export type VmDiskSummary = {
  count: number;
  totalSizeGB: number;
  usedGB: number;
  disks: VmDiskInfo[];
};

const bytesToGB = (value?: number | string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 1024 / 1024 / 1024) * 100) / 100;
};

export const fetchVmDisks = async (
  tenantId: string,
  vmId: string,
): Promise<VmDiskSummary> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/diskattachments?follow=disk`),
  );
  const attachments = parseDiskAttachments(data);
  const disks: VmDiskInfo[] = attachments
    .map((a) => {
        const d = a.disk ?? {};
      const sizeBytes = Number(d.provisioned_size ?? d.total_size ?? d.size ?? 0);
      return {
        name: d.name ?? d.alias,
        sizeGB: bytesToGB(sizeBytes),
        usedGB: d.actual_size ? bytesToGB(Number(d.actual_size)) : undefined,
        type: d.disk_type,
        interface: a.interface ?? d.interface,
      };
    })
    .sort((a, b) => b.sizeGB - a.sizeGB);
  return {
    count: disks.length,
    totalSizeGB: disks.reduce((s, d) => s + d.sizeGB, 0),
    usedGB: disks.reduce((s, d) => s + (d.usedGB ?? 0), 0),
    disks,
  };
};

export const fetchTenantDiskSummary = async (
  tenantId: string,
): Promise<VmDiskSummary> => {
  const vms = await fetchVms(tenantId);
  const results = await Promise.all(
    vms.map(async (vm) => {
      try {
        return await fetchVmDisks(tenantId, vm.id);
      } catch {
        return null;
      }
    }),
  );
  const valid = results.filter((r): r is VmDiskSummary => r !== null);
  const allDisks = valid.flatMap((r) => r.disks);
  return {
    count: allDisks.length,
    totalSizeGB: valid.reduce((s, r) => s + r.totalSizeGB, 0),
    usedGB: valid.reduce((s, r) => s + r.usedGB, 0),
    disks: allDisks,
  };
};

export const fetchVmConsoleFile = async (
  tenantId: string,
  vmId: string,
  protocol: "spice" | "vnc" = "spice",
): Promise<string> => {
  const tenant = await getTenantById(tenantId);
  const consolesResponse = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/graphicsconsoles`),
  );
  const consoles = parseGraphicsConsoles(consolesResponse);
  const selected = pickConsole(consoles, protocol);

  if (!selected?.id) {
    throw new Error("La VM no tiene consolas de gráficos disponibles (SPICE/VNC).");
  }

  const consoleProtocol = (selected.protocol ?? protocol).toLowerCase();
  const path = `/vms/${vmId}/graphicsconsoles/${selected.id}/remoteviewer`;

  const fetchConsole = async (method: "POST" | "GET") =>
    olvmFetch(tenant, path, {
      method,
      headers: {
        Accept: "application/x-virt-viewer",
        "Content-Type": "application/json",
      },
    });

  // Try native remoteviewer endpoint first
  try {
    const content = await fetchConsole("POST");
    if (typeof content === "string") {
      return content.replace("##PROTOCOL##", consoleProtocol);
    }
  } catch {
    // ignore and try GET fallback or manual ticket
  }

  try {
    const fallback = await fetchConsole("GET");
    if (typeof fallback === "string") {
      return fallback.replace("##PROTOCOL##", consoleProtocol);
    }
  } catch {
    // ignore and attempt manual ticket
  }

  // Manual ticket fallback
  const consoleDetails = (await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/graphicsconsoles/${selected.id}`),
  )) as RawConsole;

  const ticket = await requestConsoleTicket(tenant, vmId, selected.id);

  const host = consoleDetails?.address ?? "localhost";
  const port = consoleDetails?.port ?? consoleDetails?.tls_port;
  const tlsPort = consoleDetails?.tls_port;

  const vv = [
    "[virt-viewer]",
    `type=${consoleProtocol}`,
    `host=${host}`,
    port ? `port=${port}` : null,
    tlsPort ? `tls-port=${tlsPort}` : null,
    `password=${ticket}`,
    "disable-ticketing=0",
    "fullscreen=0",
    "delete-this-file=1",
  ]
    .filter(Boolean)
    .join("\n");

  return `${vv}\n`;
};

export const fetchVmConsoleInfo = async (
  tenantId: string,
  vmId: string,
  protocol: "spice" | "vnc" = "vnc",
  opts?: { ticket?: string; consoleId?: string; issueTicket?: boolean },
): Promise<ConsoleInfo> => {
  const tenant = await getTenantById(tenantId);
  const engineUrl = new URL(tenant.baseUrl);
  const engineHost = engineUrl.hostname;
  const defaultPort = 5900;
  const consolesResponse = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/graphicsconsoles`),
  );
  const consoles = parseGraphicsConsoles(consolesResponse);
  const preselected = consoles.find((c) => c.id === opts?.consoleId);
  const selected = preselected ?? pickConsole(consoles, protocol);

  if (!selected?.id) {
    throw new Error("La VM no tiene consolas de gráficos disponibles (SPICE/VNC).");
  }

  const consoleDetails = (await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/graphicsconsoles/${selected.id}`),
  )) as RawConsole;

  const proxyTicket = await requestConsoleProxyTicket(tenant, vmId, selected.id);
  let ticket = opts?.ticket;
  if (!ticket && opts?.issueTicket) {
    ticket = await requestConsoleTicket(tenant, vmId, selected.id);
  } else if (ticket) {
    const cacheKey = `${tenant.id}:${vmId}:${selected.id}`;
    ticketCache.set(cacheKey, { value: ticket, expiresAt: Date.now() + 110_000 });
  }

  let host = consoleDetails?.address;
  let port = consoleDetails?.tls_port ?? consoleDetails?.port;
  let tlsPort = consoleDetails?.tls_port;

  try {
    const vvContent = await olvmFetch(
      tenant,
      `/vms/${vmId}/graphicsconsoles/${selected.id}/remoteviewer`,
      {
        method: "GET",
        headers: {
          Accept: "application/x-virt-viewer",
          "Content-Type": "application/json",
        },
      },
    );
    if (typeof vvContent === "string") {
      const parsed = parseVirtViewerConnection(vvContent);
      // El archivo .vv suele traer el destino efectivo que usa remote-viewer.
      // Lo tomamos como fuente de verdad para que la consola embebida siga el
      // mismo camino que la consola descargable cuando OLVM publica endpoints
      // crudos que no son los realmente utilizables desde el cliente.
      host = parsed.host ?? host;
      port = parsed.tlsPort ?? parsed.port ?? port;
      tlsPort = parsed.tlsPort ?? parsed.port ?? tlsPort;
      ticket = parsed.password ?? ticket;
    }
  } catch {
    // ignore remoteviewer fallback errors
  }

  if (proxyTicket?.host) {
    host = host ?? proxyTicket.host;
  }
  if (proxyTicket?.port) {
    port = port ?? proxyTicket.port;
    tlsPort = tlsPort ?? proxyTicket.port;
  }

  const finalHost = host ?? engineHost;
  const finalPort = port ?? defaultPort;

  return {
    protocol: (selected.protocol ?? protocol).toLowerCase(),
    consoleId: selected.id,
    host: finalHost,
    port: finalPort,
    tlsPort: tlsPort ?? port ?? defaultPort,
    ticket,
    proxyTicket,
    websocket: {
      engineHost: finalHost,
    },
  };
};

export const ALLOWED_ACTIONS = [
  "start",
  "stop",
  "shutdown",
  "reboot",
  "suspend",
  "hibernate",
  "deactivate",
];

export const isSupportedAction = (action: string) =>
  ALLOWED_ACTIONS.includes(action);

export const sendVmAction = async (
  tenantId: string,
  vmId: string,
  action: string,
) => {
  if (!isSupportedAction(action)) {
    throw new Error(`Unsupported VM action: ${action}`);
  }
  const tenant = await getTenantById(tenantId);
  await olvmFetch(tenant, `/vms/${vmId}/${action}`, { method: "POST", body: "{}" });
};

type CloneVmResult = {
  vmId: string | null;
  name: string;
  pending?: boolean;
};

export type CloneVmStage = "submitting" | "waiting" | "tagging" | "stopping" | "networking" | "disks";
type CloneVmProgress = (stage: CloneVmStage, progress: number) => void | Promise<void>;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type RawNic = {
  id?: string;
  name?: string;
};

type RawDiskAttachment = {
  id?: string;
  interface?: string;
  bootable?: boolean;
  disk?: {
    id?: string;
    name?: string;
    alias?: string;
    status?: string | { state?: string };
    size?: number | string;
    total_size?: number | string;
    provisioned_size?: number | string;
    actual_size?: number | string;
    disk_type?: string;
    format?: string;
    interface?: string;
  };
};

const parseNics = (payload: unknown): RawNic[] => {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  if (!root) return [];

  if (Array.isArray(root.nic)) return root.nic as RawNic[];
  if (Array.isArray(root.nics)) return root.nics as RawNic[];
  if (
    root.nics &&
    typeof root.nics === "object" &&
    Array.isArray((root.nics as { nic?: RawNic[] }).nic)
  ) {
    return (root.nics as { nic?: RawNic[] }).nic ?? [];
  }
  return [];
};

const parseDiskAttachments = (payload: unknown): RawDiskAttachment[] => {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  if (!root) return [];

  if (Array.isArray(root.disk_attachment)) {
    return root.disk_attachment as RawDiskAttachment[];
  }
  if (Array.isArray(root.disk_attachments)) {
    return root.disk_attachments as RawDiskAttachment[];
  }
  if (
    root.disk_attachments &&
    typeof root.disk_attachments === "object" &&
    Array.isArray(
      (root.disk_attachments as { disk_attachment?: RawDiskAttachment[] })
        .disk_attachment,
    )
  ) {
    return (
      (root.disk_attachments as { disk_attachment?: RawDiskAttachment[] })
        .disk_attachment ?? []
    );
  }
  return [];
};

const waitForDisksUnlocked = async (tenant: TenantConfig, vmId: string) => {
  const timeoutMs = 10 * 60_000;
  const pollEveryMs = 4_000;
  const deadline = Date.now() + timeoutMs;
  let lastLocked: string[] = [];

  while (Date.now() < deadline) {
    const payload = await olvmFetch(
      tenant,
      withJsonFormat(`/vms/${vmId}/diskattachments?follow=disk`),
    );
    const attachments = parseDiskAttachments(payload);
    const locked = attachments
      .filter((att) => {
        const raw = att.disk?.status;
        const status =
          typeof raw === "string"
            ? raw.toLowerCase()
            : raw?.state?.toLowerCase?.() ?? "";
        return status.includes("locked");
      })
      .map((att) => att.disk?.name ?? att.disk?.id ?? att.id ?? "unknown-disk");

    if (!locked.length) return;
    lastLocked = locked;
    await sleep(pollEveryMs);
  }

  throw new Error(
    `Clon creado, pero los discos siguen bloqueados: ${lastLocked.join(", ")}`,
  );
};

const findClonedVmId = async (
  tenant: TenantConfig,
  sourceVmId: string,
  newName: string,
  knownIds: Set<string>,
  timeoutMs?: number,
): Promise<string | null> => {
  const deadline = Date.now() + (timeoutMs ?? (Number(process.env.CLONE_TIMEOUT_MS) || 600_000));
  const pollEveryMs = 5_000;

  while (Date.now() < deadline) {
    const current = await fetchAllVmsUnfiltered(tenant);
    const found = current.find(
      (vm) =>
        vm.name === newName && typeof vm.id === "string"
        && vm.id !== sourceVmId && !knownIds.has(vm.id),
    );
    if (typeof found?.id === "string") return found.id;
    await sleep(pollEveryMs);
  }

  // No apareció a tiempo: la clonación puede seguir en curso en OLVM.
  return null;
};

// Post-proceso del clon: tag del tenant + apagar + desconectar NICs + discos.
const finalizeClonedVm = async (tenant: TenantConfig, vmId: string, onProgress?: CloneVmProgress) => {
  await onProgress?.("tagging", 60);
  await applyTenantTag(tenant, vmId);
  await onProgress?.("stopping", 70);
  await ensureVmStopped(tenant, vmId);
  await onProgress?.("networking", 80);
  await disconnectVmNics(tenant, vmId);
  await ensureVmStopped(tenant, vmId);
  await onProgress?.("disks", 90);
  await waitForDisksUnlocked(tenant, vmId);
};

const ensureVmStopped = async (tenant: TenantConfig, vmId: string) => {
  try {
    await olvmFetch(tenant, `/vms/${vmId}/stop`, {
      method: "POST",
      body: "{}",
    });
  } catch (error) {
    const message = (error as Error).message.toLowerCase();
    if (
      message.includes("already") ||
      message.includes("down") ||
      message.includes("conflict")
    ) {
      return;
    }
    throw error;
  }
};

const disconnectVmNics = async (tenant: TenantConfig, vmId: string) => {
  const payload = await olvmFetch(tenant, withJsonFormat(`/vms/${vmId}/nics`));
  const nics = parseNics(payload);
  if (!nics.length) return;

  const failed: string[] = [];

  for (const nic of nics) {
    if (!nic.id) continue;

    try {
      await olvmFetch(tenant, `/vms/${vmId}/nics/${nic.id}/deactivate`, {
        method: "POST",
        body: "{}",
      });
      continue;
    } catch {
      // fallback to explicit linked=false update
    }

    const updatePayloads = [
      { linked: false },
      { nic: { linked: false } },
      nic.name ? { name: nic.name, linked: false } : null,
      nic.name ? { nic: { name: nic.name, linked: false } } : null,
    ].filter(Boolean);

    let disconnected = false;
    for (const updateBody of updatePayloads) {
      try {
        await olvmFetch(tenant, `/vms/${vmId}/nics/${nic.id}`, {
          method: "PUT",
          body: JSON.stringify(updateBody),
        });
        disconnected = true;
        break;
      } catch {
        // try next payload variant
      }
    }

    if (!disconnected) {
      failed.push(nic.id);
    }
  }

  if (failed.length) {
    throw new Error(
      `No se pudieron desconectar las NICs: ${failed.join(", ")}`,
    );
  }
};

// Aplica el tag del tenant a una VM (best-effort). Crea el tag si no existe.
const applyTenantTag = async (tenant: TenantConfig, vmId: string) => {
  const tag = tenant.tag?.trim();
  if (!tag) return;
  try {
    // Garantiza que el tag exista en OLVM antes de asignarlo.
    if (!(await findTagId(tenant, tag))) {
      await olvmFetch(tenant, "/tags", {
        method: "POST",
        headers: { "Content-Type": "application/xml", Accept: "application/xml" },
        body: `<tag><name>${tag}</name></tag>`,
      });
    }
  } catch {
    // best-effort: si no se pudo crear, se intenta asignar de todos modos.
  }
  try {
    await olvmFetch(tenant, `/vms/${vmId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml" },
      body: `<tag><name>${tag}</name></tag>`,
    });
  } catch {
    // best-effort: si el tag no existe o ya está asignado, ignorar.
  }
};

// Busca el ID de un tag por nombre en OLVM.
const findTagId = async (
  tenant: TenantConfig,
  tagName: string,
): Promise<string | null> => {
  try {
    const data = await olvmFetch(tenant, withJsonFormat("/tags"));
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const tags = root && "tag" in root ? (root.tag as { id?: string; name?: string }[]) : [];
    const found = tags.find((t) => t.name?.toLowerCase() === tagName.toLowerCase());
    return found?.id ?? null;
  } catch {
    return null;
  }
};

// Crea un tag en OLVM si no existe (best-effort).
export const createTagIfNotExists = async (
  tenantId: string,
  tagName: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const tag = tagName.trim();
  if (!tag) return;
  const existing = await findTagId(tenant, tag);
  if (existing) return;
  try {
    await olvmFetch(tenant, "/tags", {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml" },
      body: `<tag><name>${tag}</name></tag>`,
    });
  } catch {
    // best-effort
  }
};

// Asigna el tag del tenant a una VM.
export const assignTagToVm = async (
  tenantId: string,
  vmId: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  await applyTenantTag(tenant, vmId);
};

// Remueve el tag del tenant de una VM.
export const removeTagFromVm = async (
  tenantId: string,
  vmId: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const tag = tenant.tag?.trim();
  if (!tag) return;
  const tagId = await findTagId(tenant, tag);
  if (!tagId) return;
  try {
    await olvmFetch(tenant, `/vms/${vmId}/tags/${tagId}`, {
      method: "DELETE",
    });
  } catch {
    // best-effort
  }
};

export const cloneVm = async (
  tenantId: string,
  sourceVmId: string,
  newName: string,
  onProgress?: CloneVmProgress,
): Promise<CloneVmResult> => {
  const normalizedName = newName.trim();
  if (!normalizedName) {
    throw new Error("El nombre del clon es obligatorio");
  }

  const tenant = await getTenantById(tenantId);
  // El clon nace sin tag. La referencia debe tomarse antes del POST para no
  // confundir un clon rápido con una VM que ya existía.
  const before = await fetchAllVmsUnfiltered(tenant);
  if (before.some((vm) => vm.name === normalizedName)) {
    throw new Error(`Ya existe una VM con nombre ${normalizedName}`);
  }
  const knownIds = new Set(before.flatMap((vm) => typeof vm.id === "string" ? [vm.id] : []));
  await onProgress?.("submitting", 10);
  const clonePayloads = [
    { vm: { name: normalizedName } }, // formato canónico oVirt/OLVM
    { action: { vm: { name: normalizedName } } }, // fallback
    { name: normalizedName }, // fallback legacy
  ];

  let firstError: unknown;
  let started = false;
  for (const payload of clonePayloads) {
    try {
      await olvmFetch(tenant, `/vms/${sourceVmId}/clone`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      started = true;
      break;
    } catch (error) {
      if (firstError === undefined) firstError = error;
    }
  }

  if (!started) {
    throw new Error(
      `No se pudo iniciar la clonación: ${(firstError as Error).message}`,
    );
  }

  await onProgress?.("waiting", 35);
  const timeout = Number(process.env.CLONE_TIMEOUT_MS) || 1_800_000;
  const clonedVmId = await findClonedVmId(tenant, sourceVmId, normalizedName, knownIds, timeout);

  if (clonedVmId) {
    await finalizeClonedVm(tenant, clonedVmId, onProgress);
    return { vmId: clonedVmId, name: normalizedName };
  }

  throw new Error(`La VM clonada no apareció antes del timeout (${timeout} ms)`);
};

type CreateVmInput = {
  name: string;
  clusterId: string;
  templateId?: string;
  memoryMB?: number;
  cpuCores?: number;
  sockets?: number;
  comment?: string;
  os?: string;
  vnicProfileId?: string;
  cloudInit?: { ip?: string; netmask?: string; gateway?: string; dns?: string };
};

export const createVm = async (tenantId: string, payload: CreateVmInput) => {
  const tenant = await getTenantById(tenantId);
  const osType = payload.os === "windows"
    ? "windows_2022"
    : payload.os === "linux"
    ? "rhel_9x64"
    : "other";
  const body: Record<string, unknown> = {
    name: payload.name,
    cluster: { id: payload.clusterId },
    memory: payload.memoryMB ? payload.memoryMB * 1024 * 1024 : undefined,
    cpu: payload.cpuCores
      ? {
          topology: {
            cores: payload.cpuCores,
            sockets: payload.sockets ?? 1,
          },
        }
      : undefined,
    template: { id: payload.templateId || "00000000-0000-0000-0000-000000000000" },
    os: { type: osType },
    comment: payload.comment,
  };

  // Agregar NIC automática si hay vnic_profile
  if (payload.vnicProfileId) {
    body.nics = {
      nic: [{
        name: "nic1",
        interface: "virtio",
        vnic_profile: { id: payload.vnicProfileId },
        linked: true,
      }],
    };
  }

  // Cloud-init para asignación de IP sin intervenir el OS
  if (payload.cloudInit?.ip) {
    body.initialization = {
      nic_configurations: {
        nic_configuration: [{
          name: "nic1",
          on_boot: true,
          ip: {
            address: payload.cloudInit.ip,
            netmask: payload.cloudInit.netmask ?? "255.255.255.0",
            gateway: payload.cloudInit.gateway ?? "",
          },
        }],
      },
      ...(payload.cloudInit.dns
        ? { dns_servers: payload.cloudInit.dns }
        : {}),
    };
  }

  const created = await olvmFetch(tenant, "/vms", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Auto-tag multitenant (best-effort)
  const newVmId = (created as { id?: string } | null)?.id;
  if (newVmId) await applyTenantTag(tenant, newVmId);
};

type ImportOvaVmInput = {
  name: string;
  clusterId: string;
  storageDomainId: string;
  hostId: string;
  hostPath: string;
};

const findVmIdByName = async (tenant: TenantConfig, name: string): Promise<string | null> => {
  const data = await olvmFetch(
    tenant,
    withJsonFormat(`/vms?search=${encodeURIComponent(`name=${name}`)}`),
  );
  const root = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const list = root && Array.isArray(root.vm) ? root.vm as RawVm[] : [];
  return list.find((vm) => vm.name === name)?.id ?? null;
};

export const importOvaVm = async (tenantId: string, payload: ImportOvaVmInput) => {
  const tenant = await getTenantById(tenantId);
  if (await findVmIdByName(tenant, payload.name)) {
    throw new Error(`Ya existe una VM con nombre ${payload.name}`);
  }

  const vmRes = await olvmFetch(tenant, "/vms", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      cluster: { id: payload.clusterId },
      template: { id: "00000000-0000-0000-0000-000000000000" },
    }),
  }) as { id?: string } | null;
  const vmId = vmRes?.id;
  if (!vmId) throw new Error("No se pudo crear la VM");
  await applyTenantTag(tenant, vmId);
  return { vmId, pending: false };
};

export const createUploadDisk = async (
  tenantId: string,
  params: { name: string; provisionedSize: number; storageDomainId: string },
): Promise<string> => {
  const tenant = await getTenantById(tenantId);
  const res = await olvmFetch(tenant, "/disks", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      alias: params.name,
      format: "cow",
      sparse: true,
      provisioned_size: params.provisionedSize,
      storage_domains: { storage_domain: [{ id: params.storageDomainId }] },
    }),
  });
  const diskId = typeof res === "string"
    ? res.match(/<disk[^>]*id="([^"]+)"/)?.[1] ?? ""
    : String((res as Record<string, unknown>)?.id ?? "");
  if (!diskId) throw new Error("No se pudo crear el disco");

  for (let i = 0; i < 60; i++) {
    const d = await olvmFetch(tenant, withJsonFormat(`/disks/${diskId}`));
    const status = typeof d === "string"
      ? d.match(/<status[^>]*>([^<]+)<\/status>/)?.[1]?.trim() ?? ""
      : String((d as Record<string, unknown>)?.status ?? "");
    if (status === "ok") return diskId;
    await sleep(2000);
  }
  throw new Error("El disco no quedó listo tras 2 minutos");
};

export const startImageTransfer = async (
  tenantId: string,
  diskId: string,
): Promise<{ transferId: string; uploadUrl: string }> => {
  const tenant = await getTenantById(tenantId);
  const res = await olvmFetch(tenant, "/imagetransfers", {
    method: "POST",
    body: JSON.stringify({ disk: { id: diskId }, direction: "upload" }),
  });
  let transferId = "";
  let proxyUrl = "";
  if (typeof res === "string") {
    transferId = res.match(/id="([^"]+)"/)?.[1] ?? "";
    proxyUrl = res.match(/<proxy_url>([^<]+)<\/proxy_url>/)?.[1]
      ?? res.match(/<transfer_url>([^<]+)<\/transfer_url>/)?.[1] ?? "";
  } else {
    const t = res as Record<string, unknown> | null;
    transferId = String(t?.id ?? "");
    proxyUrl = String(t?.proxy_url ?? t?.transfer_url ?? "");
  }
  if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar la transferencia");

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const t = await olvmFetch(tenant, withJsonFormat(`/imagetransfers/${transferId}`));
    const phase = typeof t === "string"
      ? t.match(/<phase>([^<]+)<\/phase>/)?.[1]?.trim() ?? ""
      : String((t as Record<string, unknown>)?.phase ?? "");
    if (phase === "transferring") break;
    if (phase.includes("failure") || phase.includes("error")) throw new Error("Transfer fallida");
  }

  const engineHost = new URL(tenant.baseUrl).hostname;
  let uploadUrl = proxyUrl;
  try {
    const proxyHost = new URL(proxyUrl).hostname;
    if (proxyHost !== engineHost && proxyHost !== "localhost") {
      uploadUrl = proxyUrl.replace(proxyHost, engineHost);
    }
  } catch { /* keep */ }

  return { transferId, uploadUrl };
};

export const finalizeImageTransfer = async (tenantId: string, transferId: string) => {
  const tenant = await getTenantById(tenantId);
  await olvmFetch(tenant, `/imagetransfers/${transferId}/finalize`, {
    method: "POST",
    body: "{}",
  });
};

export type OvaDiskInfo = { id: string; name: string; size: number; storageDomainName: string };

export const fetchDiskName = async (tenantId: string, diskId: string): Promise<string> => {
  const tenant = await getTenantById(tenantId);
  const d = await olvmFetch(tenant, withJsonFormat(`/disks/${diskId}`));
  if (typeof d === "string") return d.match(/<name>([^<]+)<\/name>/)?.[1]?.trim() ?? "";
  return String((d as Record<string, unknown> | null)?.name ?? "");
};

export const fetchOvaDisks = async (tenantId: string): Promise<OvaDiskInfo[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/disks"));
  const root = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const list = root && Array.isArray(root.disk) ? root.disk as Record<string, unknown>[] : [];
  return list
    .filter((d) => {
      const name = String(d.name ?? "").toLowerCase();
      return name.endsWith(".ova") || name.endsWith(".qcow2");
    })
    .map((d) => ({
      id: String(d.id ?? ""),
      name: String(d.name ?? ""),
      size: Number(d.provisioned_size ?? 0),
      storageDomainName: (((d as Record<string, unknown>).storage_domains as { storage_domain?: { name?: string }[] } | undefined)?.storage_domain ?? [])[0]?.name ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uploadOvaAsDisk = async (
  tenantId: string,
  params: { name: string; filePath: string; fileSize: number; storageDomainId: string; virtualSize?: number },
): Promise<string> => {
  const { readFile } = await import("fs/promises");
  const tenant = await getTenantById(tenantId);
  const lowerName = params.name.toLowerCase();
  const isQcow2 = lowerName.endsWith(".qcow2");
  const diskName = (lowerName.endsWith(".ova") || isQcow2) ? params.name : `${params.name}.ova`;
  // imageio valida que el contenido coincida con el formato del disco:
  // qcow2 exige disco "cow" (con provisioned_size = tamaño virtual);
  // OVA (tar) va como "raw" con provisioned_size múltiplo de 512 y payload relleno.
  const provisionedSize = isQcow2
    ? Math.ceil((params.virtualSize && params.virtualSize > 0 ? params.virtualSize : params.fileSize) / 512) * 512
    : Math.ceil(params.fileSize / 512) * 512;

  const diskRes = await olvmFetch(tenant, "/disks", {
    method: "POST",
    body: JSON.stringify({
      name: diskName,
      alias: diskName,
      content_type: "iso",
      format: isQcow2 ? "cow" : "raw",
      sparse: isQcow2,
      provisioned_size: provisionedSize,
      storage_domains: { storage_domain: [{ id: params.storageDomainId }] },
    }),
  });
  const diskId = typeof diskRes === "string"
    ? diskRes.match(/<disk[^>]*id="([^"]+)"/)?.[1] ?? ""
    : String((diskRes as Record<string, unknown>)?.id ?? "");
  if (!diskId) throw new Error("No se pudo crear el disco OVA en el storage domain");

  for (let i = 0; i < 60; i++) {
    const d = await olvmFetch(tenant, withJsonFormat(`/disks/${diskId}`));
    const status = typeof d === "string"
      ? d.match(/<status[^>]*>([^<]+)<\/status>/)?.[1]?.trim() ?? ""
      : String((d as Record<string, unknown>)?.status ?? "");
    if (status === "ok") break;
    await sleep(2000);
  }

  const transferRes = await olvmFetch(tenant, "/imagetransfers", {
    method: "POST",
    body: JSON.stringify({ disk: { id: diskId }, direction: "upload" }),
  });
  let transferId = "";
  let proxyUrl = "";
  if (typeof transferRes === "string") {
    transferId = transferRes.match(/id="([^"]+)"/)?.[1] ?? "";
    proxyUrl = transferRes.match(/<proxy_url>([^<]+)<\/proxy_url>/)?.[1]
      ?? transferRes.match(/<transfer_url>([^<]+)<\/transfer_url>/)?.[1] ?? "";
  } else {
    const t = transferRes as Record<string, unknown> | null;
    transferId = String(t?.id ?? "");
    proxyUrl = String(t?.proxy_url ?? t?.transfer_url ?? "");
  }
  if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar transferencia OVA");

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const t = await olvmFetch(tenant, withJsonFormat(`/imagetransfers/${transferId}`));
    const phase = typeof t === "string"
      ? t.match(/<phase>([^<]+)<\/phase>/)?.[1]?.trim() ?? ""
      : String((t as Record<string, unknown>)?.phase ?? "");
    if (phase === "transferring") break;
  }

  const engineHost = new URL(tenant.baseUrl).hostname;
  let uploadUrl = proxyUrl;
  try {
    const proxyHost = new URL(proxyUrl).hostname;
    if (proxyHost !== engineHost && proxyHost !== "localhost") {
      uploadUrl = proxyUrl.replace(proxyHost, engineHost);
    }
  } catch { /* keep */ }

  const buffer = await readFile(params.filePath);
  // En discos raw imageio espera exactamente provisioned_size bytes; en cow basta el contenido qcow2.
  const payload = !isQcow2 && buffer.length < provisionedSize
    ? Buffer.concat([buffer, Buffer.alloc(provisionedSize - buffer.length)])
    : buffer;
  const uploadDispatcher = new UndiciAgent({
    connect: { rejectUnauthorized: false },
    bodyTimeout: 0,
    headersTimeout: 0,
  });
  const uploadRes = await undiciFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(payload.length) },
    body: payload,
    dispatcher: uploadDispatcher as any,
    duplex: "half",
  } as any);
  if (!uploadRes.ok) throw new Error(`Upload OVA al SD falló (${uploadRes.status})`);

  await olvmFetch(tenant, `/imagetransfers/${transferId}/finalize`, {
    method: "POST",
    body: "{}",
  });

  return diskId;
};

export const downloadOvaFromSd = async (
  tenantId: string,
  diskId: string,
): Promise<{ transferId: string; downloadUrl: string }> => {
  const tenant = await getTenantById(tenantId);
  const transferRes = await olvmFetch(tenant, "/imagetransfers", {
    method: "POST",
    body: JSON.stringify({ disk: { id: diskId }, direction: "download" }),
  });
  let transferId = "";
  let proxyUrl = "";
  if (typeof transferRes === "string") {
    transferId = transferRes.match(/id="([^"]+)"/)?.[1] ?? "";
    proxyUrl = transferRes.match(/<proxy_url>([^<]+)<\/proxy_url>/)?.[1]
      ?? transferRes.match(/<transfer_url>([^<]+)<\/transfer_url>/)?.[1] ?? "";
  } else {
    const t = transferRes as Record<string, unknown> | null;
    transferId = String(t?.id ?? "");
    proxyUrl = String(t?.proxy_url ?? t?.transfer_url ?? "");
  }
  if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar download del OVA");

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const t = await olvmFetch(tenant, withJsonFormat(`/imagetransfers/${transferId}`));
    const phase = typeof t === "string"
      ? t.match(/<phase>([^<]+)<\/phase>/)?.[1]?.trim() ?? ""
      : String((t as Record<string, unknown>)?.phase ?? "");
    if (phase === "transferring") break;
  }

  const engineHost = new URL(tenant.baseUrl).hostname;
  let downloadUrl = proxyUrl;
  try {
    const proxyHost = new URL(proxyUrl).hostname;
    if (proxyHost !== engineHost && proxyHost !== "localhost") {
      downloadUrl = proxyUrl.replace(proxyHost, engineHost);
    }
  } catch { /* keep */ }

  return { transferId, downloadUrl };
};

export const deleteOvaDisk = async (tenantId: string, diskId: string) => {
  const tenant = await getTenantById(tenantId);
  await olvmFetch(tenant, `/disks/${diskId}`, { method: "DELETE" });
};

export const waitForDiskReady = async (
  tenantId: string,
  diskId: string,
  timeoutMs = 120_000,
) => {
  const tenant = await getTenantById(tenantId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await olvmFetch(tenant, withJsonFormat(`/disks/${diskId}`));
    const status = typeof d === "string"
      ? d.match(/<status[^>]*>([^<]+)<\/status>/)?.[1]?.trim() ?? ""
      : String((d as Record<string, unknown>)?.status ?? "");
    if (status === "ok") return;
    await sleep(3_000);
  }
};

export const attachDiskToVm = async (
  tenantId: string,
  vmId: string,
  diskId: string,
  opts?: { bootable?: boolean; interface?: string },
) => {
  const tenant = await getTenantById(tenantId);
  const payload = {
    disk: { id: diskId },
    active: true,
    bootable: opts?.bootable ?? true,
    interface: opts?.interface ?? "virtio_scsi",
  };
  let attached = false;
  let lastErr = "";
  for (let i = 0; i < 12; i++) {
    try {
      await olvmFetch(tenant, `/vms/${vmId}/diskattachments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      attached = true;
      break;
    } catch (err) {
      lastErr = (err as Error).message;
      if (!lastErr.toLowerCase().includes("locked") && !lastErr.toLowerCase().includes("transferr")) throw err;
      await sleep(5000);
    }
  }
  if (!attached) throw new Error(`No se pudo conectar el disco: ${lastErr}`);
};

type UpdateVmInput = {
  memoryMB?: number;
  cpuCores?: number;
  sockets?: number;
};

export const updateVmResources = async (
  tenantId: string,
  vmId: string,
  payload: UpdateVmInput,
) => {
  const tenant = await getTenantById(tenantId);
  const body: Record<string, unknown> = {
    cpu: payload.cpuCores
      ? {
          topology: {
            cores: payload.cpuCores,
            sockets: payload.sockets ?? 1,
          },
        }
      : undefined,
  };

  if (payload.memoryMB) {
    const newMemory = payload.memoryMB * 1024 * 1024;
    body.memory = newMemory;
    const current = await olvmFetch(tenant, withJsonFormat(`/vms/${vmId}`)) as {
      memory_policy?: { max?: number };
    } | null;
    const currentMax = Number(current?.memory_policy?.max ?? 0);
    if (newMemory > currentMax) {
      body.memory_policy = { max: newMemory };
    }
  }

  await olvmFetch(tenant, `/vms/${vmId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
};

export type OlvmHost = { id: string; name: string; address?: string };

export const fetchHosts = async (tenantId: string): Promise<OlvmHost[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/hosts"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && Array.isArray(root.host) ? root.host as Record<string, unknown>[] : [];
  return list
    .map((h) => ({
      id: String(h.id ?? ""),
      name: String(h.name ?? ""),
      address: typeof h.address === "string" ? h.address : undefined,
    }))
    .filter((h) => h.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type StorageDomainInfo = {
  id: string;
  name: string;
  type: string;
  status?: string;
  availableGB: number;
  usedGB: number;
  totalGB: number;
};

export const fetchStorageDomains = async (
  tenantId: string,
): Promise<StorageDomainInfo[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/storagedomains"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "storage_domain" in root
    ? (root.storage_domain as Record<string, unknown>[])
    : [];

  const all: StorageDomainInfo[] = list
    .filter((sd) => sd.type !== "image")
    .map((sd) => {
      const available = Number(sd.available ?? 0);
      const used = Number(sd.used ?? 0);
      return {
        id: String(sd.id ?? ""),
        name: String(sd.name ?? ""),
        type: String(sd.type ?? "data"),
        status: typeof sd.status === "string" ? sd.status : (sd.status as { state?: string })?.state,
        availableGB: bytesToGB(available),
        usedGB: bytesToGB(used),
        totalGB: bytesToGB(available + used),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filtrar por storage domains asignados al tenant + shared del engine
  const tenantSds = tenant.storageDomains && tenant.storageDomains.length > 0
    ? tenant.storageDomains
    : [];
  const sharedSds = tenant.sharedStorageDomains ?? [];
  const allowed = [...tenantSds, ...sharedSds];

  if (allowed.length > 0) {
    return all.filter((sd) => allowed.includes(sd.name));
  }

  return all;
};

export const fetchAllStorageDomains = async (
  tenantId: string,
): Promise<StorageDomainInfo[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/storagedomains"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "storage_domain" in root
    ? (root.storage_domain as Record<string, unknown>[])
    : [];
  return list
    .filter((sd) => sd.type !== "image")
    .map((sd) => {
      const available = Number(sd.available ?? 0);
      const used = Number(sd.used ?? 0);
      return {
        id: String(sd.id ?? ""),
        name: String(sd.name ?? ""),
        type: String(sd.type ?? "data"),
        status: typeof sd.status === "string" ? sd.status : (sd.status as { state?: string })?.state,
        availableGB: bytesToGB(available),
        usedGB: bytesToGB(used),
        totalGB: bytesToGB(available + used),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type OlvmCluster = { id: string; name: string };
export type OlvmTemplate = { id: string; name: string };

export const fetchClusters = async (tenantId: string): Promise<OlvmCluster[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/clusters"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "cluster" in root ? (root.cluster as Record<string, unknown>[]) : [];
  return list
    .map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? "") }))
    .filter((c) => c.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchTemplates = async (tenantId: string): Promise<OlvmTemplate[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/templates"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "template" in root ? (root.template as Record<string, unknown>[]) : [];
  return list
    .map((t) => ({ id: String(t.id ?? ""), name: String(t.name ?? "") }))
    .filter((t) => t.id && t.name !== "Blank")
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type IsoInfo = { id: string; name: string; storageDomainId: string; storageDomainName: string; sizeGB: number };

export const fetchIsos = async (tenantId: string): Promise<IsoInfo[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/disks"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "disk" in root ? (root.disk as Record<string, unknown>[]) : [];
  return (list as Record<string, unknown>[])
    .filter((d) => String(d.content_type ?? "") === "iso")
    .map((d) => {
      const sds = Array.isArray(d.storage_domains) ? d.storage_domains : [];
      const sd = sds[0] as Record<string, unknown> | undefined;
      return {
        id: String(d.id ?? ""),
        name: String(d.alias ?? d.name ?? ""),
        storageDomainId: sd ? String(sd.id ?? "") : "",
        storageDomainName: sd ? String(sd.name ?? "") : "",
        sizeGB: bytesToGB(Number(d.actual_size ?? d.provisioned_size ?? 0)),
      };
    })
    .filter((iso) => iso.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const mountIso = async (tenantId: string, vmId: string, isoId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const body = JSON.stringify({ file: { id: isoId } });
  await olvmFetch(tenant, `/vms/${vmId}/cdroms/00000000-0000-0000-0000-000000000000`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json", Accept: "application/json", current: "false" },
  });
};

export const unmountIso = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const body = JSON.stringify({ file: { id: "00000000-0000-0000-0000-000000000000" } });
  await olvmFetch(tenant, `/vms/${vmId}/cdroms/00000000-0000-0000-0000-000000000000`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json", Accept: "application/json", current: "false" },
  });
};

export const fetchCurrentIso = async (tenantId: string, vmId: string): Promise<string | null> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat(`/vms/${vmId}/cdroms/00000000-0000-0000-0000-000000000000`));
  const file = (data as Record<string, unknown> | null)?.cdrom as Record<string, unknown> | undefined;
  const fileId = (file?.file as Record<string, unknown> | undefined)?.id;
  return fileId && fileId !== "00000000-0000-0000-0000-000000000000" ? String(fileId) : null;
};

export const addDiskToVm = async (
  tenantId: string,
  vmId: string,
  params: { sizeGB: number; storageDomainId: string; name?: string; interface?: string },
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const provisionedSize = params.sizeGB * 1024 * 1024 * 1024;
  const diskPayload: Record<string, unknown> = {
    name: params.name || `disk-${vmId.slice(0, 8)}`,
    provisioned_size: provisionedSize,
    format: "cow",
    storage_domains: {
      storage_domain: [{ id: params.storageDomainId }],
    },
  };
  const created = await olvmFetch(tenant, "/disks", {
    method: "POST",
    body: JSON.stringify(diskPayload),
  });
  const diskId = (created as { id?: string } | null)?.id;
  if (!diskId) throw new Error("No se pudo crear el disco");

  const attachPayload = {
    disk: { id: diskId },
    active: true,
    bootable: true,
    interface: params.interface || "virtio_scsi",
  };

  let attached = false;
  let lastErr = "";
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await olvmFetch(tenant, `/vms/${vmId}/diskattachments`, {
        method: "POST",
        body: JSON.stringify(attachPayload),
      });
      attached = true;
      break;
    } catch (err) {
      lastErr = (err as Error).message;
      if (!lastErr.toLowerCase().includes("locked")) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!attached) throw new Error(`Disco creado pero no se pudo conectar: ${lastErr}`);
};

export type VmDiskDetail = {
  attachmentId: string;
  diskId: string;
  name: string;
  sizeGB: number;
  interface: string;
  bootable: boolean;
  status: string;
};

export const fetchVmDiskDetails = async (
  tenantId: string,
  vmId: string,
): Promise<VmDiskDetail[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/diskattachments?follow=disk`),
  );
  const attachments = parseDiskAttachments(data);
  return attachments.map((a) => {
    const d = a.disk ?? {};
    return {
      attachmentId: String(a.id ?? ""),
      diskId: String(d.id ?? ""),
      name: String(d.name ?? d.alias ?? "sin nombre"),
      sizeGB: bytesToGB(Number(d.provisioned_size ?? d.total_size ?? 0)),
      interface: String(a.interface ?? d.interface ?? ""),
      bootable: Boolean(a.bootable),
      status: String(d.status ?? ""),
    };
  });
};

export const deleteVmDisk = async (
  tenantId: string,
  vmId: string,
  attachmentId: string,
  diskId: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  await olvmFetch(tenant, `/vms/${vmId}/diskattachments/${attachmentId}`, {
    method: "DELETE",
  });
  await olvmFetch(tenant, `/disks/${diskId}`, {
    method: "DELETE",
  });
};

export const runOnceFromCd = async (
  tenantId: string,
  vmId: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const payload = {
    vm: {
      os: {
        boot: {
          devices: { device: ["cdrom", "hd"] },
        },
      },
    },
  };
  await olvmFetch(tenant, `/vms/${vmId}/start`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });
};

export const deleteVm = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  try {
    await olvmFetch(tenant, `/vms/${vmId}/stop`, { method: "POST", body: "{}" });
  } catch (err) {
    const msg = (err as Error).message.toLowerCase();
    if (!msg.includes("already") && !msg.includes("down") && !msg.includes("not")) throw err;
  }
  await new Promise((r) => setTimeout(r, 3000));
  await olvmFetch(tenant, `/vms/${vmId}`, { method: "DELETE" });
};

export const uploadIso = async (
  tenantId: string,
  fileName: string,
  fileSize: number,
  storageDomainId: string,
  fileBuffer: Buffer,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);

  // 1. Crear disco ISO (sparse:false requerido por OLVM)
  const diskRes = await olvmFetch(tenant, "/disks", {
    method: "POST",
    body: JSON.stringify({
      name: fileName,
      alias: fileName,
      content_type: "iso",
      format: "raw",
      sparse: false,
      provisioned_size: fileSize,
      storage_domains: { storage_domain: [{ id: storageDomainId }] },
    }),
  });
  // OLVM puede devolver XML o JSON
  let diskId = "";
  if (typeof diskRes === "string") {
    const m = diskRes.match(/<disk[^>]*id="([^"]+)"/);
    diskId = m?.[1] ?? "";
  } else {
    diskId = String((diskRes as Record<string, unknown>)?.id ?? "");
  }
  if (!diskId) throw new Error("No se pudo crear el disco ISO");

  // Esperar a que el disco esté ok (puede tardar un poco)
  for (let i = 0; i < 30; i++) {
    const d = await olvmFetch(tenant, withJsonFormat(`/disks/${diskId}`));
    let status = "";
    if (typeof d === "string") {
      const m = d.match(/<status[^>]*>([^<]+)<\/status>/);
      status = m?.[1]?.trim() ?? "";
    } else {
      status = String((d as Record<string, unknown>)?.status ?? "");
    }
    if (status === "ok") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 2. Crear image transfer (upload)
  const transferRes = await olvmFetch(tenant, "/imagetransfers", {
    method: "POST",
    body: JSON.stringify({
      disk: { id: diskId },
      direction: "upload",
    }),
  });
  let transferId = "";
  let proxyUrl = "";
  if (typeof transferRes === "string") {
    const idMatch = transferRes.match(/<(?:image_transfer|image-transfer)[^>]*id="([^"]+)"/) ?? transferRes.match(/id="([^"]+)"/);
    transferId = idMatch?.[1] ?? "";
    const proxyMatch = transferRes.match(/<proxy_url>([^<]+)<\/proxy_url>/);
    const transferUrlMatch = transferRes.match(/<transfer_url>([^<]+)<\/transfer_url>/);
    proxyUrl = proxyMatch?.[1] ?? transferUrlMatch?.[1] ?? "";
  } else {
    const t = transferRes as Record<string, unknown> | null;
    transferId = String(t?.id ?? "");
    proxyUrl = String(t?.proxy_url ?? t?.transfer_url ?? "");
  }
  if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar la transferencia de imagen");

  // 3. Esperar a que el transfer esté listo
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const t = await olvmFetch(tenant, withJsonFormat(`/imagetransfers/${transferId}`));
    let phase = "";
    if (typeof t === "string") {
      const pm = t.match(/<phase>([^<]+)<\/phase>/);
      phase = pm?.[1]?.trim() ?? "";
    } else {
      phase = String((t as Record<string, unknown>)?.phase ?? "");
    }
    if (phase === "transferring") { ready = true; break; }
    if (phase.includes("failure") || phase.includes("error")) break;
  }
  if (!ready) throw new Error("La transferencia no se pudo inicializar");

  // 4. Subir el archivo - reemplazar hostname por IP del engine
  const engineHost = new URL(tenant.baseUrl).hostname;
  let uploadUrl = proxyUrl;
  try {
    const proxyHost = new URL(proxyUrl).hostname;
    if (proxyHost !== engineHost && proxyHost !== "localhost") {
      uploadUrl = proxyUrl.replace(proxyHost, engineHost);
    }
  } catch { /* usar URL original */ }

  const uploadDispatcher = new UndiciAgent({
    connect: { rejectUnauthorized: false },
    bodyTimeout: 0,
    headersTimeout: 0,
    keepAliveTimeout: 30000,
  });
  const uploadRes = await undiciFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(fileSize) },
    body: fileBuffer,
    dispatcher: uploadDispatcher as any,
    duplex: "half",
  } as any);
  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => "");
    throw new Error(`Upload fallido (${uploadRes.status}): ${detail}`);
  }

  // 5. Finalizar transfer
  await olvmFetch(tenant, `/imagetransfers/${transferId}/finalize`, {
    method: "POST",
    body: "{}",
  });
};

// ── NICs ────────────────────────────────────────────────────────────────────

export type VmNic = {
  id: string;
  name: string;
  mac: string;
  linked: boolean;
  plugged: boolean;
  interface: string;
  networkId: string;
  networkName: string;
  vnicProfileId: string;
  ipv4?: string;
};

export const fetchVmNics = async (
  tenantId: string,
  vmId: string,
): Promise<VmNic[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}/nics`),
  );
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "nic" in root ? (root.nic as Record<string, unknown>[]) : [];

  let ipMap: Record<string, string[]> = {};
  try {
    const rd = await olvmFetch(tenant, withJsonFormat(`/vms/${vmId}/reporteddevices`));
    const rdRoot = rd && typeof rd === "object" ? (rd as Record<string, unknown>) : null;
    const devs = rdRoot && "reported_device" in rdRoot ? (rdRoot.reported_device as Record<string, unknown>[]) : [];
    for (const d of devs) {
      const mac = String((d.mac as Record<string, unknown>)?.address ?? "").toLowerCase();
      if (!mac) continue;
      const ipStr = extractGuestIps(d.ips);
      if (!ipStr) continue;
      for (const addr of ipStr.split(",").map((s) => s.trim())) {
        if (addr && !addr.includes(":")) {
          (ipMap[mac] ??= []).push(addr);
        }
      }
    }
  } catch { /* best-effort */ }

  return list.map((n) => {
    const vp = (n.vnic_profile ?? n.vnicprofile ?? {}) as Record<string, unknown>;
    const network = (vp.network ?? n.network ?? {}) as Record<string, unknown>;
    const mac = String(n.mac ?? "");
    const macAddr = (n.mac as Record<string, unknown>)?.address ?? mac;
    return {
      id: String(n.id ?? ""),
      name: String(n.name ?? ""),
      mac: String(macAddr ?? ""),
      linked: String(n.linked) === "true",
      plugged: String(n.plugged) === "true",
      interface: String(n.interface ?? ""),
      networkId: String(network.id ?? ""),
      networkName: String(network.name ?? "") || String(vp.name ?? ""),
      vnicProfileId: String(vp.id ?? ""),
      ipv4: (ipMap[String(macAddr).toLowerCase()] ?? []).join(", ") || undefined,
    };
  });
};

export const addNicToVm = async (
  tenantId: string,
  vmId: string,
  params: { name?: string; interface?: string; vnicProfileId: string },
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  const baseBody = {
    name: params.name || `nic-${Date.now().toString(36)}`,
    interface: params.interface || "virtio",
    vnic_profile: { id: params.vnicProfileId },
  };
  try {
    await olvmFetch(tenant, `/vms/${vmId}/nics`, {
      method: "POST",
      body: JSON.stringify({ ...baseBody, linked: true, plugged: true }),
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("409") || msg.toLowerCase().includes("conflict") || msg.toLowerCase().includes("network does not exist")) {
      await olvmFetch(tenant, `/vms/${vmId}/nics`, {
        method: "POST",
        body: JSON.stringify({ ...baseBody, linked: true, plugged: false }),
      });
      return;
    }
    throw err;
  }
};

export const updateNicLink = async (
  tenantId: string,
  vmId: string,
  nicId: string,
  linked: boolean,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  await olvmFetch(tenant, `/vms/${vmId}/nics/${nicId}`, {
    method: "PUT",
    body: JSON.stringify({ linked, plugged: linked }),
  });
};

export const deleteNicFromVm = async (
  tenantId: string,
  vmId: string,
  nicId: string,
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  try {
    await olvmFetch(tenant, `/vms/${vmId}/nics/${nicId}/deactivate`, {
      method: "POST",
      body: "{}",
    });
  } catch { /* VM apagada o ya desactivada — ignorar */ }
  await sleep(1000);
  await olvmFetch(tenant, `/vms/${vmId}/nics/${nicId}`, {
    method: "DELETE",
  });
};

// ── Networks & vNIC Profiles ────────────────────────────────────────────────

export type OlvmNetwork = { id: string; name: string; datacenterId: string };
export type OlvmVnicProfile = { id: string; name: string; networkId: string; networkName: string };

export const fetchNetworks = async (tenantId: string, skipFilter = false): Promise<OlvmNetwork[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/networks"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "network" in root ? (root.network as Record<string, unknown>[]) : [];
  const allowedNetworks = !skipFilter && tenant.networks && tenant.networks.length > 0 ? tenant.networks : null;
  return list
    .map((n) => ({
      id: String(n.id ?? ""),
      name: String(n.name ?? ""),
      datacenterId: String(((n.data_center ?? {}) as Record<string, unknown>).id ?? ""),
    }))
    .filter((n) => !allowedNetworks || allowedNetworks.some((an) => an.toLowerCase() === n.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchVnicProfiles = async (tenantId: string): Promise<OlvmVnicProfile[]> => {
  const tenant = await getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/vnicprofiles"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "vnic_profile" in root ? (root.vnic_profile as Record<string, unknown>[]) : [];
  const allowedNetworks = tenant.networks && tenant.networks.length > 0 ? tenant.networks : null;
  return list
    .map((p) => {
      const network = (p.network ?? {}) as Record<string, unknown>;
      return {
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        networkId: String(network.id ?? ""),
        networkName: String(network.name ?? p.name ?? ""),
      };
    })
    .filter((p) => p.id)
    .filter((p) => !allowedNetworks || allowedNetworks.some((an) => an.toLowerCase() === p.networkName.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
};
