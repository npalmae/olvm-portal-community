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
  metrics?: VmMetric;
};

type OlvmFetchInit = RequestInit & { allowInsecure?: boolean };

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
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: buildHeaders(tenant, init?.headers),
      dispatcher: getDispatcher(tenant),
    });
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
  const memoryPercent =
    lookup("memory.usage") ??
    lookup("memory_usage") ??
    lookup("usage.memory") ??
    lookup("memory.utilization") ??
    lookup("usage.memory.percent");
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

const normalizeVm = (vm: RawVm): VmSummary => {
  const cpuTopology = vm.cpu?.topology ?? {};
  const sockets = Number(cpuTopology.sockets ?? cpuTopology["@sockets"]);
  const cores = Number(cpuTopology.cores ?? cpuTopology["@cores"]);
  const threads = Number(cpuTopology.threads ?? cpuTopology["@threads"]);
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
    id: vm.id ?? vm.uuid ?? vm.name,
    name: vm.name ?? "VM",
    status: vm.status?.state ?? vm.status ?? "unknown",
    cluster: vm.cluster?.name ?? vm.cluster?.id,
    template: vm.template?.name ?? vm.template?.id,
    host: vm.host?.name ?? vm.host?.id,
    memoryMB: vm.memory ? Math.round(Number(vm.memory) / 1024 / 1024) : undefined,
    cpuCores: vcpuCount || (cores || sockets || threads ? totalCores : undefined),
    sockets,
    metrics: mapStatistics(vm.statistics),
  };
};

const withJsonFormat = (path: string) => {
  const hasQuery = path.includes("?");
  const hasFormat = /[?&]format=/i.test(path);
  if (hasFormat) return path;
  return `${path}${hasQuery ? "&" : "?"}format=json`;
};

export const fetchVms = async (tenantId: string): Promise<VmSummary[]> => {
  const tenant = getTenantById(tenantId);
  const data = (await olvmFetch(
    tenant,
    withJsonFormat("/vms?all_content=true&follow=statistics"),
  )) as unknown;
  const root =
    data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (root && "vm" in root && Array.isArray((root as { vm?: unknown }).vm)) {
    return ((root as { vm?: RawVm[] }).vm ?? []).map(normalizeVm);
  }
  const vmsField = root && "vms" in root ? (root as { vms?: unknown }).vms : null;
  if (Array.isArray(vmsField)) {
    return (vmsField as RawVm[]).map(normalizeVm);
  }
  const nested = vmsField && typeof vmsField === "object" ? vmsField : null;
  if (nested && "vm" in nested && Array.isArray((nested as { vm?: unknown }).vm)) {
    return ((nested as { vm?: RawVm[] }).vm ?? []).map(normalizeVm);
  }
  return [];
};

export const fetchVmById = async (
  tenantId: string,
  vmId: string,
): Promise<VmSummary> => {
  const tenant = getTenantById(tenantId);
  const data = (await olvmFetch(
    tenant,
    withJsonFormat(`/vms/${vmId}?all_content=true&follow=statistics`),
  )) as RawVm;
  return normalizeVm(data);
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
    template: payload.templateId ? { id: payload.templateId } : undefined,
    comment: payload.comment,
  };

  await olvmFetch(tenant, "/vms", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
