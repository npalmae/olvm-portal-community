import https from "https";
import { Agent as UndiciAgent } from "undici";
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
  // Las conexiones cambiaron: limpiar también el caché de nombres de hosts
  if (tenantId) hostNameCache.delete(tenantId);
  else hostNameCache.clear();
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
  const auth = input.token
    ? `Bearer ${input.token}`
    : input.username && input.password
      ? `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf-8").toString("base64")}`
      : null;
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
  try {
    const res = await fetch(`${baseUrl}/vms?max=1`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      dispatcher,
    } as any);
    if (res.status === 200) {
      return { ok: true, status: 200, detail: "Conexión exitosa" };
    }
    if (res.status === 401) {
      return { ok: false, status: 401, detail: "Credenciales inválidas" };
    }
    return {
      ok: false,
      status: res.status,
      detail: `Respuesta inesperada (HTTP ${res.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: `No se pudo conectar: ${(error as Error).message}`,
    };
  }
};

const buildHeaders = (tenant: TenantConfig, headers?: HeadersInit) => {
  let authHeader: string;
  if (tenant.token) {
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

  let response: Response;
  try {
    response = await fetch(
      url,
      {
        ...init,
        cache: "no-store",
        headers: buildHeaders(tenant, init?.headers),
        dispatcher: getDispatcher(tenant),
      } as any,
    );
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
  const diskReadBytes = lookup("disk.read.bytes");
  const diskWriteBytes = lookup("disk.write.bytes");
  const networkBytes =
    (lookup("net.received.bytes") ?? 0) + (lookup("net.transmitted.bytes") ?? 0);

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

const vmMatchesTenantTag = (vm: RawVm, expectedTag?: string) => {
  const normalizedExpected = expectedTag?.trim().toLowerCase();
  if (!normalizedExpected) return true;
  return parseTagNames(vm).some((tag) => tag.toLowerCase() === normalizedExpected);
};

export const enforceVmTagPolicy = async (tenantId: string, vmId: string) => {
  const tenant = getTenantById(tenantId);
  const expectedTag = tenant.tag?.trim();
  if (!expectedTag) return;

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
  const tenant = getTenantById(tenantId);
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

export const fetchVmById = async (
  tenantId: string,
  vmId: string,
): Promise<VmSummary> => {
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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

  // Construir URL para WebSocket proxy local
  const finalHost = host ?? engineHost;
  const finalPort = port ?? defaultPort;
  const wsProtocol = "ws:";
  const wsUrl = `${wsProtocol}//localhost:3010/?targets=${encodeURIComponent(`tcp://${finalHost}:${finalPort}`)}&insecure=1`;

  return {
    protocol: (selected.protocol ?? protocol).toLowerCase(),
    consoleId: selected.id,
    host: finalHost,
    port: finalPort,
    tlsPort: tlsPort ?? port ?? defaultPort,
    ticket,
    proxyTicket,
    websocket: {
      wsUrl,
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
  const tenant = getTenantById(tenantId);
  await olvmFetch(tenant, `/vms/${vmId}/${action}`, { method: "POST", body: "{}" });
};

type CloneVmResult = {
  vmId: string | null;
  name: string;
  pending?: boolean;
};

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
  tenantId: string,
  sourceVmId: string,
  newName: string,
  timeoutMs?: number,
): Promise<string | null> => {
  const before = await fetchVms(tenantId);
  const existingName = before.find((vm) => vm.name === newName);
  if (existingName) {
    throw new Error(`Ya existe una VM con nombre ${newName}`);
  }
  const knownIds = new Set(before.map((vm) => vm.id));
  const deadline = Date.now() + (timeoutMs ?? (Number(process.env.CLONE_TIMEOUT_MS) || 600_000));
  const pollEveryMs = 5_000;

  while (Date.now() < deadline) {
    const current = await fetchVms(tenantId);
    const found = current.find(
      (vm) =>
        vm.name === newName && vm.id !== sourceVmId && !knownIds.has(vm.id),
    );
    if (found?.id) return found.id;
    await sleep(pollEveryMs);
  }

  // No apareció a tiempo: la clonación puede seguir en curso en OLVM.
  return null;
};

// Post-proceso del clon: tag del tenant + apagar + desconectar NICs + discos.
const finalizeClonedVm = async (tenant: TenantConfig, vmId: string) => {
  await applyTenantTag(tenant, vmId);
  await ensureVmStopped(tenant, vmId);
  await disconnectVmNics(tenant, vmId);
  await ensureVmStopped(tenant, vmId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
  await applyTenantTag(tenant, vmId);
};

// Remueve el tag del tenant de una VM.
export const removeTagFromVm = async (
  tenantId: string,
  vmId: string,
): Promise<void> => {
  const tenant = getTenantById(tenantId);
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
): Promise<CloneVmResult> => {
  const normalizedName = newName.trim();
  if (!normalizedName) {
    throw new Error("El nombre del clon es obligatorio");
  }

  const tenant = getTenantById(tenantId);
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

  // Espera breve en la request; si la VM aparece rápido, se finaliza en caliente.
  const clonedVmId = await findClonedVmId(tenantId, sourceVmId, normalizedName, 120_000);

  if (clonedVmId) {
    await finalizeClonedVm(tenant, clonedVmId);
    return { vmId: clonedVmId, name: normalizedName };
  }

  // Clon lento: el post-proceso continúa en background (hasta 30 min) y la VM
  // queda etiquetada/apagada/desconectada cuando aparezca. No se bloquea al usuario.
  const bgTimeout = Number(process.env.CLONE_TIMEOUT_MS) || 1_800_000;
  void (async () => {
    try {
      const id = await findClonedVmId(tenantId, sourceVmId, normalizedName, bgTimeout);
      if (id) await finalizeClonedVm(tenant, id);
    } catch {
      // best-effort: si falla, la VM queda creada pero sin post-proceso.
    }
  })();

  return { vmId: null, name: normalizedName, pending: true };
};

type CreateVmInput = {
  name: string;
  clusterId: string;
  templateId?: string;
  memoryMB?: number;
  cpuCores?: number;
  sockets?: number;
  comment?: string;
};

export const createVm = async (tenantId: string, payload: CreateVmInput) => {
  const tenant = getTenantById(tenantId);
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
    comment: payload.comment,
  };

  const created = await olvmFetch(tenant, "/vms", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Auto-tag multitenant (best-effort)
  const newVmId = (created as { id?: string } | null)?.id;
  if (newVmId) await applyTenantTag(tenant, newVmId);
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
  const tenant = getTenantById(tenantId);
  const body: Record<string, unknown> = {
    memory: payload.memoryMB ? payload.memoryMB * 1024 * 1024 : undefined,
    cpu: payload.cpuCores
      ? {
          topology: {
            cores: payload.cpuCores,
            sockets: payload.sockets ?? 1,
          },
        }
      : undefined,
  };

  await olvmFetch(tenant, `/vms/${vmId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
  const data = await olvmFetch(tenant, withJsonFormat("/clusters"));
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = root && "cluster" in root ? (root.cluster as Record<string, unknown>[]) : [];
  return list
    .map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? "") }))
    .filter((c) => c.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchTemplates = async (tenantId: string): Promise<OlvmTemplate[]> => {
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
  const body = JSON.stringify({ file: { id: isoId } });
  await olvmFetch(tenant, `/vms/${vmId}/cdroms/00000000-0000-0000-0000-000000000000`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json", Accept: "application/json", current: "false" },
  });
};

export const unmountIso = async (tenantId: string, vmId: string): Promise<void> => {
  const tenant = getTenantById(tenantId);
  const body = JSON.stringify({ file: { id: "00000000-0000-0000-0000-000000000000" } });
  await olvmFetch(tenant, `/vms/${vmId}/cdroms/00000000-0000-0000-0000-000000000000`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json", Accept: "application/json", current: "false" },
  });
};

export const fetchCurrentIso = async (tenantId: string, vmId: string): Promise<string | null> => {
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
  const tenant = getTenantById(tenantId);
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
