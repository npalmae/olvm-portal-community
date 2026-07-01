"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { SixmanagerMark } from "@/components/SixmanagerMark";

type Tenant = {
  id: string;
  name: string;
  baseUrl: string;
};

type Vm = {
  id: string;
  name: string;
  status: string;
  cluster?: string;
  template?: string;
  host?: string;
  memoryMB?: number;
  cpuCores?: number;
  sockets?: number;
  metrics?: {
    cpuPercent?: number;
    memoryPercent?: number;
    diskReadBytes?: number;
    diskWriteBytes?: number;
    networkBytes?: number;
  };
};

type VmDraft = {
  memoryMB?: string;
  cpuCores?: string;
  sockets?: string;
};

type NewVmDraft = {
  name: string;
  clusterId: string;
  templateId: string;
  memoryMB: string;
  cpuCores: string;
  sockets: string;
  comment: string;
};

type ActionLog = {
  vmId: string;
  action: string;
  status: "pending" | "ok" | "error";
  timestamp: number;
  message?: string;
};

type RfbCtor = any;
type RfbInstance = any;

const clampPercent = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const UsageBar = ({ value }: { value?: number }) => {
  const percent = clampPercent(value);
  const isMissing = value === undefined || Number.isNaN(value);
  const width =
    value === undefined || Number.isNaN(value)
      ? "8%"
      : `${Math.max(4, percent)}%`;
  return (
    <div className="mt-2 h-2 rounded-full border border-white/5 bg-white/10 relative">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 via-sky-400/80 to-amber-300/80 shadow-[0_0_0_2px_rgba(255,255,255,0.04)] transition-all"
        style={{ width, opacity: isMissing ? 0.35 : 1 }}
        aria-label={isMissing ? "Sin datos" : `${percent}%`}
      />
      <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-semibold text-white/80 drop-shadow">
        {isMissing ? "—" : `${percent.toFixed(0)}%`}
      </span>
    </div>
  );
};

const MetricDonut = ({
  value,
  label,
  tint,
  valueLabel,
  helper,
}: {
  value?: number;
  label: string;
  tint: string;
  valueLabel: string;
  helper: string;
}) => {
  const percent = clampPercent(value);
  const circumference = 2 * Math.PI * 42;
  const dashOffset = circumference - (percent / 100) * circumference;

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="10"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={tint}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-semibold text-white">
              {value === undefined || Number.isNaN(value)
                ? "—"
                : `${percent.toFixed(0)}%`}
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">
              live
            </span>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">
            {label}
          </p>
          <p className="text-2xl font-semibold text-white">{valueLabel}</p>
          <p className="text-xs text-white/55">{helper}</p>
        </div>
      </div>
    </div>
  );
};

const StatusStack = ({
  total,
  up,
  down,
}: {
  total: number;
  up: number;
  down: number;
}) => {
  const other = Math.max(0, total - up - down);
  const segments = [
    { label: "Encendidas", value: up, color: "bg-emerald-400" },
    { label: "Apagadas", value: down, color: "bg-amber-300" },
    { label: "Transición", value: other, color: "bg-sky-300" },
  ].filter((segment) => segment.value > 0);

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-white/50">
        Estado del tenant
      </p>
      <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-white/10">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={`${segment.color} h-full`}
            style={{ width: `${(segment.value / Math.max(total, 1)) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          { label: "Encendidas", value: up, color: "bg-emerald-400" },
          { label: "Apagadas", value: down, color: "bg-amber-300" },
          { label: "Total", value: total, color: "bg-white/40" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
              <span className="text-xs text-white/55">{item.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ResourceBars = ({
  title,
  items,
  colorClass,
}: {
  title: string;
  items: { id: string; name: string; value: number; label: string }[];
  colorClass: string;
}) => {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-white/50">{title}</p>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-white/45">Sin datos visibles.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-white">
                  {item.name}
                </p>
                <span className="text-xs text-white/55">{item.label}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${colorClass}`}
                  style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const parseJsonSafe = async (res: Response) => {
  const text = await res.text();
  const trimmed = text.trim();
  const looksHtml = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html");
  if (looksHtml) {
    return { error: "Respuesta inesperada del servidor (HTML/404)" };
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text ? { error: text } : null;
  }
};

const statusBadge = (status: string) => {
  const normalized = status?.toLowerCase?.() ?? "unknown";
  const base =
    "rounded-full px-3 py-1 text-xs font-semibold tracking-wide border";
  switch (normalized) {
    case "up":
      return `${base} border-emerald-500/40 bg-emerald-500/15 text-emerald-200`;
    case "down":
    case "stopped":
      return `${base} border-amber-400/40 bg-amber-400/15 text-amber-100`;
    case "powering_up":
    case "reboot_in_progress":
      return `${base} border-sky-400/40 bg-sky-400/15 text-sky-100`;
    default:
      return `${base} border-white/20 bg-white/10 text-white/80`;
  }
};

const formatNumber = (value?: number, opts: Intl.NumberFormatOptions = {}) => {
  if (value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 1,
    ...opts,
  }).format(value);
};

const formatBytes = (value?: number) => {
  if (value === undefined || Number.isNaN(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(size, { maximumFractionDigits: size >= 100 ? 0 : 1 })} ${units[unitIndex]}`;
};

const toGB = (mb?: number) => {
  if (!mb) return "—";
  return `${formatNumber(mb / 1024)} GB`;
};

const ActionButton = ({
  label,
  onClick,
  loading,
  disabled = false,
  title,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  title?: string;
}) => (
  <button
    onClick={onClick}
    disabled={loading || disabled}
    title={title}
    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {loading ? "…" : label}
  </button>
);

export default function Home() {
  const { data: session } = useSession();
  const showExperimentalConsole = true;
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [vms, setVms] = useState<Vm[]>([]);
  const [selectedVmId, setSelectedVmId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [consoleLoading, setConsoleLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inventoryExpanded, setInventoryExpanded] = useState(true);
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});
  const [detailTab, setDetailTab] = useState<
    "overview" | "actions" | "resources" | "provisioning"
  >("overview");
  const [resourceDrafts, setResourceDrafts] = useState<Record<string, VmDraft>>(
    {},
  );
  const [newVm, setNewVm] = useState<NewVmDraft>({
    name: "",
    clusterId: "",
    templateId: "",
    memoryMB: "",
    cpuCores: "",
    sockets: "1",
    comment: "",
  });
  const [actionHistory, setActionHistory] = useState<ActionLog[]>([]);
  const [embeddedConsole, setEmbeddedConsole] = useState<{
    vmId: string;
    status: "idle" | "connecting" | "connected" | "error";
    error?: string | null;
    rfb?: RfbInstance | null;
    iframeUrl?: string | null;
  }>({ vmId: "", status: "idle", error: null, rfb: null });
  const [useProxy, setUseProxy] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [cloneWizard, setCloneWizard] = useState<{
    open: boolean;
    sourceVmId: string;
    sourceVmName: string;
    newName: string;
    submitting: boolean;
    error: string | null;
  }>({
    open: false,
    sourceVmId: "",
    sourceVmName: "",
    newName: "",
    submitting: false,
    error: null,
  });
  const closingConsole = useRef(false);
  const embeddedConsoleSession = useRef(0);
  const consoleRef = useMemo(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.id = "embedded-console";
    div.style.width = "100%";
    div.style.height = "100%";
    div.style.position = "relative";
    div.style.overflow = "hidden";
    return div;
  }, []);

  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [error, success]);

  useEffect(() => {
    const loadTenants = async () => {
      try {
        const res = await fetch("/api/tenants");
        const data = await parseJsonSafe(res);
        if (!res.ok) {
          throw new Error(data?.error ?? "No se pudieron cargar los tenants");
        }
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error("No hay tenants configurados en OLVM_TENANTS");
        }
        const sanitized = data.filter((t) => Boolean(t.id));
        setTenants(sanitized);
        setSelectedTenant(sanitized[0]?.id ?? "");
      } catch (err) {
        console.error(err);
        setError(
          "No pude cargar los tenants. Revisa las variables de entorno OLVM.",
        );
      }
    };
    loadTenants().catch(console.error);
  }, []);

  useEffect(() => {
    if (!tenants.length) return;
    const firstTenantId = tenants[0]?.id;
    const selectedIsInvalid =
      !selectedTenant ||
      selectedTenant === "undefined" ||
      !tenants.some((t) => t.id === selectedTenant);
    if (selectedIsInvalid && firstTenantId) {
      setSelectedTenant(firstTenantId);
    }
  }, [selectedTenant, tenants]);

  useEffect(() => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    const loadVms = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/vms`);
        const data = await parseJsonSafe(res);
        if (!res.ok) throw new Error(data.error ?? "Error cargando VMs");
        setVms(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadVms().catch(console.error);
  }, [selectedTenant]);

  useEffect(() => {
    if (!vms.length) {
      setSelectedVmId("");
      return;
    }
    if (selectedVmId && !vms.some((vm) => vm.id === selectedVmId)) {
      setSelectedVmId("");
    }
  }, [selectedVmId, vms]);

  const tenantName = useMemo(
    () => tenants.find((t) => t.id === selectedTenant)?.name ?? "",
    [selectedTenant, tenants],
  );

  const refresh = async () => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${selectedTenant}/vms`);
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error ?? "Error cargando VMs");
      setVms(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (vmId: string, action: string) => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    setActionLoading(`${vmId}-${action}`);
    setError(null);
    setSuccess(null);
    const startedAt = Date.now();
    setActionHistory((prev) => [
      { vmId, action, status: "pending", timestamp: startedAt },
      ...prev.slice(0, 2),
    ]);
    try {
      const res = await fetch(
        `/api/tenants/${selectedTenant}/vms/${vmId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error ?? "Error ejecutando acción");
      setSuccess(`Acción ${action} enviada`);
      setActionHistory((prev) =>
        prev.map((entry) =>
          entry.vmId === vmId && entry.timestamp === startedAt
            ? { ...entry, status: "ok", message: data?.error }
            : entry,
        ),
      );
      await refresh();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      setActionHistory((prev) =>
        prev.map((entry) =>
          entry.vmId === vmId && entry.timestamp === startedAt
            ? { ...entry, status: "error", message }
            : entry,
        ),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const openCloneWizard = (vm: Vm) => {
    setCloneWizard({
      open: true,
      sourceVmId: vm.id,
      sourceVmName: vm.name,
      newName: `${vm.name}-clone`,
      submitting: false,
      error: null,
    });
  };

  const closeCloneWizard = () => {
    if (cloneWizard.submitting) return;
    setCloneWizard({
      open: false,
      sourceVmId: "",
      sourceVmName: "",
      newName: "",
      submitting: false,
      error: null,
    });
  };

  const submitCloneWizard = async () => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    const sourceVmId = cloneWizard.sourceVmId;
    const sourceVmName = cloneWizard.sourceVmName;
    const cloneName = cloneWizard.newName.trim();

    if (!sourceVmId) return;
    if (!cloneName) {
      setCloneWizard((prev) => ({
        ...prev,
        error: "Ingresa un nombre para la VM clonada.",
      }));
      return;
    }

    setCloneWizard((prev) => ({ ...prev, submitting: true, error: null }));
    setActionLoading(`${sourceVmId}-clone`);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/tenants/${selectedTenant}/vms/${sourceVmId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "clone",
            cloneName,
          }),
        },
      );
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "No se pudo clonar la VM");
      }

      setSuccess(
        `Clon ${cloneName} creado. Quedó apagado y con red desconectada.`,
      );
      setActionHistory((prev) => [
        {
          vmId: sourceVmId,
          action: `clone -> ${cloneName}`,
          status: "ok",
          timestamp: Date.now(),
          message: `Origen: ${sourceVmName}`,
        },
        ...prev.slice(0, 2),
      ]);
      setCloneWizard({
        open: false,
        sourceVmId: "",
        sourceVmName: "",
        newName: "",
        submitting: false,
        error: null,
      });
      await refresh();
    } catch (err) {
      const message = (err as Error).message;
      setCloneWizard((prev) => ({
        ...prev,
        submitting: false,
        error: message,
      }));
    } finally {
      setActionLoading(null);
    }
  };

  const downloadConsole = async (vmId: string, protocol: "spice" | "vnc" = "spice") => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    setConsoleLoading(vmId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/tenants/${selectedTenant}/vms/${vmId}/console?protocol=${protocol}`,
      );
      if (!res.ok) {
        const data = await parseJsonSafe(res);
        throw new Error(data?.error ?? "No se pudo obtener la consola");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${vmId}-${protocol}.vv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setSuccess("Consola descargada. Ábrela con remote-viewer (Spice/VNC).");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConsoleLoading(null);
    }
  };

  const updateResources = async (vmId: string) => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    const draft = resourceDrafts[vmId];
    if (!draft?.memoryMB && !draft?.cpuCores) {
      setError("Ingresa memoria y/o CPU para actualizar.");
      return;
    }
    setActionLoading(`${vmId}-update`);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${selectedTenant}/vms/${vmId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memoryMB: draft.memoryMB ? Number(draft.memoryMB) : undefined,
          cpuCores: draft.cpuCores ? Number(draft.cpuCores) : undefined,
          sockets: draft.sockets ? Number(draft.sockets) : undefined,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error ?? "No se pudo actualizar");
      setSuccess("Recursos actualizados");
      setActionHistory((prev) => [
        {
          vmId,
          action: `update resources (${[
            draft.memoryMB ? `RAM ${draft.memoryMB}MB` : "",
            draft.cpuCores ? `vCPU ${draft.cpuCores}` : "",
            draft.sockets ? `sockets ${draft.sockets}` : "",
          ]
            .filter(Boolean)
            .join(", ")})`,
          status: "ok",
          timestamp: Date.now(),
        },
        ...prev.slice(0, 2),
      ]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleNewVm = async () => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    if (!newVm.name || !newVm.clusterId) {
      setError("Nombre y Cluster ID son obligatorios");
      return;
    }
    setActionLoading("create");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/tenants/${selectedTenant}/vms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newVm.name,
          clusterId: newVm.clusterId,
          templateId: newVm.templateId || undefined,
          memoryMB: newVm.memoryMB ? Number(newVm.memoryMB) : undefined,
          cpuCores: newVm.cpuCores ? Number(newVm.cpuCores) : undefined,
          sockets: newVm.sockets ? Number(newVm.sockets) : undefined,
          comment: newVm.comment || undefined,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear la VM");
      setSuccess("VM creada (el aprovisionamiento puede tardar)");
      setActionHistory((prev) => [
        {
          vmId: data?.id ?? newVm.name,
          action: "create VM",
          status: "ok",
          timestamp: Date.now(),
        },
        ...prev.slice(0, 2),
      ]);
      setNewVm({
        name: "",
        clusterId: "",
        templateId: "",
        memoryMB: "",
        cpuCores: "",
        sockets: "1",
        comment: "",
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const totals = useMemo(() => {
    const up = vms.filter((vm) => vm.status?.toLowerCase() === "up").length;
    const down = vms.filter((vm) => vm.status?.toLowerCase() !== "up").length;
    return { up, down, total: vms.length };
  }, [vms]);

  const filteredVms = vms;

  const visibleTotals = useMemo(() => {
    const up = filteredVms.filter((vm) => vm.status?.toLowerCase() === "up").length;
    const down = filteredVms.filter((vm) => vm.status?.toLowerCase() !== "up").length;
    return { up, down, total: filteredVms.length };
  }, [filteredVms]);

  const inventoryTree = useMemo(() => {
    const clusters = new Map<
      string,
      {
        key: string;
        label: string;
        hosts: Map<
          string,
          {
            key: string;
            label: string;
            vms: Vm[];
            up: number;
            down: number;
          }
        >;
        up: number;
        down: number;
      }
    >();

    for (const vm of filteredVms) {
      const clusterLabel = vm.cluster?.trim() || "Sin cluster";
      const clusterKey = clusterLabel.toLowerCase();
      const hostLabel = vm.host?.trim() || "Host N/D";
      const hostKey = `${clusterKey}::${hostLabel.toLowerCase()}`;

      const currentCluster = clusters.get(clusterKey) ?? {
        key: clusterKey,
        label: clusterLabel,
        hosts: new Map(),
        up: 0,
        down: 0,
      };

      const currentHost = currentCluster.hosts.get(hostKey) ?? {
        key: hostKey,
        label: hostLabel,
        vms: [],
        up: 0,
        down: 0,
      };

      currentHost.vms.push(vm);
      if ((vm.status?.toLowerCase?.() ?? "") === "up") {
        currentHost.up += 1;
        currentCluster.up += 1;
      } else {
        currentHost.down += 1;
        currentCluster.down += 1;
      }

      currentCluster.hosts.set(hostKey, currentHost);
      clusters.set(clusterKey, currentCluster);
    }

    return Array.from(clusters.values())
      .map((cluster) => ({
        ...cluster,
        hosts: Array.from(cluster.hosts.values())
          .map((host) => ({
            ...host,
            vms: [...host.vms].sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredVms]);

  const selectedVm = useMemo(
    () => vms.find((vm) => vm.id === selectedVmId) ?? null,
    [selectedVmId, vms],
  );

  useEffect(() => {
    if (!inventoryTree.length) {
      setExpandedClusters({});
      setExpandedHosts({});
      return;
    }

    setExpandedClusters((prev) => {
      const next: Record<string, boolean> = {};
      for (const cluster of inventoryTree) {
        next[cluster.key] = prev[cluster.key] ?? true;
      }
      return next;
    });
  }, [inventoryTree]);

  useEffect(() => {
    if (!inventoryTree.length) {
      setExpandedHosts({});
      return;
    }

    setExpandedHosts((prev) => {
      const next: Record<string, boolean> = {};
      for (const cluster of inventoryTree) {
        for (const host of cluster.hosts) {
          next[host.key] = prev[host.key] ?? true;
        }
      }
      return next;
    });
  }, [inventoryTree]);

  useEffect(() => {
    setDetailTab(selectedVmId ? "overview" : "overview");
  }, [selectedVmId]);

  const tenantResourceSummary = useMemo(() => {
    const provisionedMemoryMB = vms.reduce(
      (sum, vm) => sum + (vm.memoryMB ?? 0),
      0,
    );
    const provisionedCpuCores = vms.reduce(
      (sum, vm) => sum + (vm.cpuCores ?? 0),
      0,
    );
    const estimatedCpuUsed = vms.reduce((sum, vm) => {
      const cpuCores = vm.cpuCores ?? 0;
      const cpuPercent = vm.metrics?.cpuPercent ?? 0;
      return sum + cpuCores * (cpuPercent / 100);
    }, 0);
    const estimatedMemoryUsedMB = vms.reduce((sum, vm) => {
      const memoryMB = vm.memoryMB ?? 0;
      const memoryPercent = vm.metrics?.memoryPercent ?? 0;
      return sum + memoryMB * (memoryPercent / 100);
    }, 0);
    const diskTrafficBytes = vms.reduce(
      (sum, vm) =>
        sum +
        (vm.metrics?.diskReadBytes ?? 0) +
        (vm.metrics?.diskWriteBytes ?? 0),
      0,
    );
    const networkTrafficBytes = vms.reduce(
      (sum, vm) => sum + (vm.metrics?.networkBytes ?? 0),
      0,
    );

    return {
      provisionedMemoryMB,
      provisionedCpuCores,
      estimatedCpuUsed,
      estimatedMemoryUsedMB,
      cpuUsagePercent:
        provisionedCpuCores > 0
          ? (estimatedCpuUsed / provisionedCpuCores) * 100
          : undefined,
      memoryUsagePercent:
        provisionedMemoryMB > 0
          ? (estimatedMemoryUsedMB / provisionedMemoryMB) * 100
          : undefined,
      diskTrafficBytes,
      networkTrafficBytes,
    };
  }, [vms]);

  const topMemoryVms = useMemo(
    () =>
      [...vms]
        .sort((a, b) => (b.memoryMB ?? 0) - (a.memoryMB ?? 0))
        .slice(0, 5)
        .map((vm) => ({
          id: vm.id,
          name: vm.name,
          value: vm.memoryMB ?? 0,
          label: toGB(vm.memoryMB),
        })),
    [vms],
  );

  const topCpuVms = useMemo(
    () =>
      [...vms]
        .sort(
          (a, b) => (b.metrics?.cpuPercent ?? 0) - (a.metrics?.cpuPercent ?? 0),
        )
        .slice(0, 5)
        .map((vm) => ({
          id: vm.id,
          name: vm.name,
          value: vm.metrics?.cpuPercent ?? 0,
          label: `${formatNumber(vm.metrics?.cpuPercent)}%`,
        })),
    [vms],
  );

  const tenantDashboardPanel = (
    <section className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-lg shadow-sky-500/5 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Dashboard del tenant</p>
          <p className="text-xs text-white/60">
            Resumen consolidado de capacidad asignada y consumo visible en{" "}
            {tenantName || "este tenant"}.
          </p>
        </div>
        <p className="text-xs text-white/45">
          Selecciona una VM en el inventario para cambiar a vista detallada.
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr,1.15fr,0.85fr]">
        <MetricDonut
          label="CPU del tenant"
          tint="#38bdf8"
          value={tenantResourceSummary.cpuUsagePercent}
          valueLabel={`${formatNumber(
            tenantResourceSummary.provisionedCpuCores,
            { maximumFractionDigits: 0 },
          )} vCPU`}
          helper={`Uso estimado: ${formatNumber(
            tenantResourceSummary.estimatedCpuUsed,
          )} vCPU`}
        />
        <MetricDonut
          label="RAM del tenant"
          tint="#34d399"
          value={tenantResourceSummary.memoryUsagePercent}
          valueLabel={toGB(tenantResourceSummary.provisionedMemoryMB)}
          helper={`Uso estimado: ${toGB(
            tenantResourceSummary.estimatedMemoryUsedMB,
          )}`}
        />
        <StatusStack total={totals.total} up={totals.up} down={totals.down} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr,1fr,0.9fr]">
        <ResourceBars
          title="Huella de RAM por servidor"
          items={topMemoryVms}
          colorClass="bg-gradient-to-r from-emerald-400 to-teal-300"
        />
        <ResourceBars
          title="Carga CPU visible"
          items={topCpuVms}
          colorClass="bg-gradient-to-r from-sky-400 to-cyan-300"
        />
        <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">
            Tráfico activo
          </p>
          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4">
              <p className="text-xs text-amber-50/75">Disco</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {formatBytes(tenantResourceSummary.diskTrafficBytes)}
              </p>
              <p className="mt-1 text-xs text-white/55">
                Lectura + escritura acumulada en las VMs visibles.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-300/15 bg-sky-300/10 p-4">
              <p className="text-xs text-sky-50/75">Red</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {formatBytes(tenantResourceSummary.networkTrafficBytes)}
              </p>
              <p className="mt-1 text-xs text-white/55">
                Tráfico combinado reportado por OLVM.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const detailPanel = (
    <aside className="rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/25 backdrop-blur">
      <div className="border-b border-white/10 pb-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/45">
          Panel de detalles
        </p>
        <div className="mt-3">
          {selectedVm ? (
            <>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold text-white">{selectedVm.name}</h3>
                <span className={statusBadge(selectedVm.status)}>
                  {selectedVm.status ?? "desconocido"}
                </span>
              </div>
              <p className="mt-2 text-xs text-white/55">
                {tenantName || "Tenant"} / {selectedVm.cluster || "Sin cluster"} / {selectedVm.host || "Host N/D"}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-white">Vista general</h3>
              <p className="mt-2 text-sm text-white/55">
                Selecciona un recurso en el árbol o en la grilla para ver su detalle.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          { key: "overview", label: "Detalle" },
          { key: "actions", label: "Acciones" },
          { key: "resources", label: "Recursos" },
          { key: "provisioning", label: "Provisionar" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() =>
              setDetailTab(
                tab.key as "overview" | "actions" | "resources" | "provisioning",
              )
            }
            className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
              detailTab === tab.key
                ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-100"
                : "border-white/10 bg-black/15 text-white/65 hover:bg-white/5"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {detailTab === "overview" && (
          selectedVm ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">Identidad</p>
                <div className="mt-3 space-y-2 text-sm text-white/70">
                  <p><span className="text-white/45">ID:</span> {selectedVm.id}</p>
                  <p><span className="text-white/45">Template:</span> {selectedVm.template ?? "N/D"}</p>
                  <p><span className="text-white/45">Cluster:</span> {selectedVm.cluster ?? "N/D"}</p>
                  <p><span className="text-white/45">Host:</span> {selectedVm.host ?? "N/D"}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-white/50">CPU</p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatNumber(selectedVm.metrics?.cpuPercent)}%
                  </p>
                  <UsageBar value={selectedVm.metrics?.cpuPercent} />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-white/50">Memoria</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{toGB(selectedVm.memoryMB)}</p>
                  <UsageBar value={selectedVm.metrics?.memoryPercent} />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">
                  Tenant activo
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {tenantName || "Sin tenant"}
                </p>
                <p className="mt-2 text-sm text-white/55">
                  Usa el árbol o la grilla para hacer drill-down sobre un recurso.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-white/45">Total</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.total}</p>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <p className="text-xs text-white/45">Up</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.up}</p>
                </div>
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                  <p className="text-xs text-white/45">Down</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.down}</p>
                </div>
              </div>
            </div>
          )
        )}

        {detailTab === "actions" && (
          selectedVm ? (
            <div className="space-y-4">
              <div className="grid gap-2">
                <ActionButton
                  label="Start"
                  onClick={() => runAction(selectedVm.id, "start")}
                  loading={actionLoading === `${selectedVm.id}-start`}
                />
                <ActionButton
                  label="Stop"
                  onClick={() => runAction(selectedVm.id, "stop")}
                  loading={actionLoading === `${selectedVm.id}-stop`}
                />
                <ActionButton
                  label="Shutdown"
                  onClick={() => runAction(selectedVm.id, "shutdown")}
                  loading={actionLoading === `${selectedVm.id}-shutdown`}
                />
                <ActionButton
                  label="Reboot"
                  onClick={() => runAction(selectedVm.id, "reboot")}
                  loading={actionLoading === `${selectedVm.id}-reboot`}
                />
                <ActionButton
                  label="Clone"
                  onClick={() => openCloneWizard(selectedVm)}
                  loading={actionLoading === `${selectedVm.id}-clone`}
                />
                <ActionButton
                  label="Consola (VNC)"
                  onClick={() => downloadConsole(selectedVm.id, "vnc")}
                  loading={consoleLoading === selectedVm.id}
                />
                {showExperimentalConsole && (
                  <ActionButton
                    label="Consola embebida"
                    onClick={() => openEmbeddedConsole(selectedVm.id)}
                    loading={consoleLoading === selectedVm.id}
                    disabled={(selectedVm.status?.toLowerCase?.() ?? "") !== "up"}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedVmId("")}
                className="w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10"
              >
                Volver a vista general
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
              Selecciona una VM para habilitar acciones operativas.
            </div>
          )
        )}

        {detailTab === "resources" && (
          selectedVm ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm font-semibold text-white">Ajuste de recursos</p>
              <p className="mt-1 text-xs text-white/55">
                Edita memoria, vCPU y sockets para la VM seleccionada.
              </p>
              <div className="mt-4 space-y-3">
                <label className="text-xs text-white/60">
                  Memoria (MB)
                  <input
                    type="number"
                    min={512}
                    value={resourceDrafts[selectedVm.id]?.memoryMB ?? ""}
                    onChange={(e) =>
                      setResourceDrafts((prev) => ({
                        ...prev,
                        [selectedVm.id]: {
                          ...prev[selectedVm.id],
                          memoryMB: e.target.value,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-white/60">
                    vCPU
                    <input
                      type="number"
                      min={1}
                      value={resourceDrafts[selectedVm.id]?.cpuCores ?? ""}
                      onChange={(e) =>
                        setResourceDrafts((prev) => ({
                          ...prev,
                          [selectedVm.id]: {
                            ...prev[selectedVm.id],
                            cpuCores: e.target.value,
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                    />
                  </label>
                  <label className="text-xs text-white/60">
                    Sockets
                    <input
                      type="number"
                      min={1}
                      value={resourceDrafts[selectedVm.id]?.sockets ?? ""}
                      onChange={(e) =>
                        setResourceDrafts((prev) => ({
                          ...prev,
                          [selectedVm.id]: {
                            ...prev[selectedVm.id],
                            sockets: e.target.value,
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                    />
                  </label>
                </div>
                <button
                  onClick={() => updateResources(selectedVm.id)}
                  disabled={actionLoading === `${selectedVm.id}-update`}
                  className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:bg-emerald-400/25 disabled:opacity-60"
                >
                  {actionLoading === `${selectedVm.id}-update`
                    ? "Actualizando…"
                    : "Actualizar recursos"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
              Elige una VM para editar sus recursos.
            </div>
          )
        )}

        {detailTab === "provisioning" && (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Crear nueva VM</p>
                <p className="text-xs text-white/60">
                  Usa IDs de cluster y template disponibles en OLVM.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <label className="text-xs text-white/70">
                Nombre
                <input
                  value={newVm.name}
                  onChange={(e) => setNewVm((v) => ({ ...v, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  placeholder="vm-app-01"
                />
              </label>
              <label className="text-xs text-white/70">
                Cluster ID
                <input
                  value={newVm.clusterId}
                  onChange={(e) =>
                    setNewVm((v) => ({ ...v, clusterId: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </label>
              <label className="text-xs text-white/70">
                Template ID (opcional)
                <input
                  value={newVm.templateId}
                  onChange={(e) =>
                    setNewVm((v) => ({ ...v, templateId: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  placeholder="template uuid"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-white/70">
                  Memoria (MB)
                  <input
                    type="number"
                    min={512}
                    value={newVm.memoryMB}
                    onChange={(e) =>
                      setNewVm((v) => ({ ...v, memoryMB: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                    placeholder="4096"
                  />
                </label>
                <label className="text-xs text-white/70">
                  vCPU
                  <input
                    type="number"
                    min={1}
                    value={newVm.cpuCores}
                    onChange={(e) =>
                      setNewVm((v) => ({ ...v, cpuCores: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                    placeholder="2"
                  />
                </label>
              </div>
              <label className="text-xs text-white/70">
                Sockets
                <input
                  type="number"
                  min={1}
                  value={newVm.sockets}
                  onChange={(e) =>
                    setNewVm((v) => ({ ...v, sockets: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  placeholder="1"
                />
              </label>
              <label className="text-xs text-white/70">
                Comentario (opcional)
                <textarea
                  value={newVm.comment}
                  onChange={(e) =>
                    setNewVm((v) => ({ ...v, comment: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                  placeholder="Propósito, ticket, etc."
                  rows={3}
                />
              </label>
              <button
                onClick={handleNewVm}
                disabled={actionLoading === "create"}
                className="mt-2 w-full rounded-xl border border-sky-400/40 bg-sky-400/15 px-4 py-3 text-sm font-semibold text-sky-50 transition hover:-translate-y-0.5 hover:bg-sky-400/25 disabled:opacity-60"
              >
                {actionLoading === "create" ? "Creando..." : "Crear VM"}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );

  const closeEmbeddedConsole = () => {
    embeddedConsoleSession.current += 1;
    closingConsole.current = true;
    embeddedConsole.rfb?.disconnect?.();
    setEmbeddedConsole({
      vmId: "",
      status: "idle",
      error: null,
      rfb: null,
      iframeUrl: null,
    });
    if (consoleRef) {
      consoleRef.replaceChildren();
      if (consoleRef.parentElement) {
        consoleRef.parentElement.removeChild(consoleRef);
      }
    }
    setTimeout(() => {
      closingConsole.current = false;
    }, 1000);
  };

  const focusEmbeddedConsole = (rfb?: RfbInstance | null) => {
    try {
      rfb?.focus?.({ preventScroll: true });
    } catch {
      // no-op
    }

    try {
      const canvas = consoleRef?.querySelector("canvas") as HTMLCanvasElement | null;
      canvas?.focus?.({ preventScroll: true });
    } catch {
      // no-op
    }
  };

  const openEmbeddedConsole = async (vmId: string) => {
    if (!selectedTenant || selectedTenant === "undefined" || !consoleRef) return;
    // Evita solicitudes duplicadas mientras se conecta la misma VM
    if (consoleLoading === vmId || embeddedConsole.status === "connecting") return;
    // Fuerza estado de conexión visible y resetea errores previos
    const sessionId = embeddedConsoleSession.current + 1;
    embeddedConsoleSession.current = sessionId;
    closingConsole.current = false;
    setEmbeddedConsole({
      vmId,
      status: "connecting",
      error: null,
      rfb: null,
      iframeUrl: null,
    });
    setConsoleLoading(vmId);
    try {
      const infoRes = await fetch(
        `/api/tenants/${selectedTenant}/vms/${vmId}/console/info?protocol=vnc&withTicket=1`,
        { cache: "no-store" },
      );
      const info = await parseJsonSafe(infoRes);
      if (!infoRes.ok || info?.error) {
        throw new Error(info?.error ?? "No se pudo obtener la consola");
      }

      const currentTicket = info.ticket as string | undefined;
      if (!currentTicket) {
        throw new Error("No se recibió el ticket de consola (password) desde OLVM.");
      }
      const proxyUrl = `/api/console/proxy?tenantId=${selectedTenant}&vmId=${vmId}&protocol=vnc&ticket=${encodeURIComponent(currentTicket)}&consoleId=${encodeURIComponent(info.consoleId ?? "")}`;
      const proxyRes = await fetch(proxyUrl, { cache: "no-store" });
      const proxy = await parseJsonSafe(proxyRes);
      if (!proxyRes.ok || !proxy?.proxyWsUrl) {
        throw new Error(proxy?.error ?? "No hay websocket de consola disponible");
      }

      const iframeUrl =
        `/console?wsUrl=${encodeURIComponent(proxy.proxyWsUrl as string)}` +
        `&ticket=${encodeURIComponent(currentTicket)}` +
        `&vmId=${encodeURIComponent(vmId)}`;

      setEmbeddedConsole({
        vmId,
        status: "connected",
        error: null,
        rfb: null,
        iframeUrl,
      });
    } catch (err) {
      if (embeddedConsoleSession.current !== sessionId) return;
      setEmbeddedConsole({
        vmId,
        status: "error",
        error: (err as Error).message,
        rfb: null,
        iframeUrl: null,
      });
    } finally {
      setConsoleLoading(null);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_26%),#07111f]">
      <div className="flex min-h-screen">
        <aside
          className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-white/10 bg-slate-950/95 shadow-2xl shadow-black/40 transition-all duration-300 ${
            sidebarCollapsed ? "w-[92px]" : "w-[320px]"
          }`}
        >
          <div className="border-b border-white/8 px-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className={sidebarCollapsed ? "hidden" : "block"}>
                <SixmanagerMark subtitle="OLVM multitenant" />
                <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-white/35">
                  Menu lateral
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  Inventario de virtualizacion
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
                title={sidebarCollapsed ? "Expandir menu" : "Contraer menu"}
              >
                {sidebarCollapsed ? ">>" : "<<"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                {sidebarCollapsed ? (
                  <div className="flex justify-center">
                    <button
                      onClick={refresh}
                      className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100"
                      title="Refrescar inventario"
                    >
                      R
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                      Tenant activo
                      <select
                        value={selectedTenant}
                        onChange={(e) => setSelectedTenant(e.target.value)}
                        className="mt-3 w-full rounded-xl border border-white/15 bg-slate-900/90 px-3 py-3 text-sm font-semibold text-white outline-none ring-emerald-400/30 focus:ring-2"
                      >
                        {tenants.map((tenant) => (
                          <option
                            key={tenant.id}
                            value={tenant.id}
                            className="bg-slate-900 text-white"
                          >
                            {tenant.name} ({tenant.id})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={refresh}
                      className="mt-3 w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                    >
                      Refrescar inventario
                    </button>
                  </>
                )}
              </div>

              <nav className="rounded-2xl border border-white/8 bg-white/[0.04] p-2">
                <button
                  type="button"
                  onClick={() => setInventoryExpanded((prev) => !prev)}
                  className={`flex w-full items-center rounded-xl px-3 py-3 transition hover:bg-white/5 ${
                    sidebarCollapsed ? "justify-center" : "justify-between text-left"
                  }`}
                >
                  {sidebarCollapsed ? (
                    <span className="text-lg font-semibold text-white/80">
                      {inventoryExpanded ? "-" : "+"}
                    </span>
                  ) : (
                    <>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                          Inventario
                        </p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          Maquinas virtuales
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-white/70">
                        {inventoryExpanded ? "Ocultar" : "Abrir"}
                      </span>
                    </>
                  )}
                </button>

                {!sidebarCollapsed && (
                  <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2 text-xs text-white/45">
                    {visibleTotals.total} visibles en {tenantName || "tenant"}
                  </div>
                )}

                {inventoryExpanded && (
                  <div className={`space-y-2 ${sidebarCollapsed ? "mt-2" : "mt-3"}`}>
                    {!sidebarCollapsed && (
                      <div className="rounded-xl border border-white/8 bg-slate-900/80">
                        <button
                          type="button"
                          onClick={() => setSelectedVmId("")}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-sky-300">▾</span>
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {tenantName || "Tenant"}
                              </p>
                              <p className="text-xs text-white/45">
                                Nodo raiz del inventario
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-white/55">
                            {inventoryTree.length} clusters
                          </span>
                        </button>
                      </div>
                    )}

                    {!sidebarCollapsed && (
                      <button
                        type="button"
                        onClick={() => setSelectedVmId("")}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                          !selectedVm
                            ? "border-sky-400/45 bg-sky-400/12"
                            : "border-white/8 bg-black/20 hover:border-white/10 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 text-sm text-sky-300">⌂</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white">
                              Vista general
                            </p>
                            <p className="mt-1 truncate text-xs text-white/45">
                              Dashboard principal del tenant activo
                            </p>
                          </div>
                        </div>
                      </button>
                    )}

                    {vms.length === 0 && !loading && !sidebarCollapsed && (
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-4 text-sm text-white/50">
                        No hay VMs visibles para este tenant.
                      </div>
                    )}

                    {sidebarCollapsed
                      ? [
                          <button
                            key="dashboard-home"
                            type="button"
                            onClick={() => setSelectedVmId("")}
                            title="Vista general"
                            className={`w-full rounded-xl border px-0 py-3 transition ${
                              !selectedVm
                                ? "border-sky-400/45 bg-sky-400/12"
                                : "border-transparent hover:border-white/10 hover:bg-white/5"
                            }`}
                          >
                            <div className="flex justify-center text-sm font-semibold text-sky-200">
                              ⌂
                            </div>
                          </button>,
                          ...vms.map((vm) => (
                            <button
                              key={vm.id}
                              type="button"
                              onClick={() => setSelectedVmId(vm.id)}
                              title={vm.name}
                              className={`w-full rounded-xl border px-0 py-3 transition ${
                                selectedVmId === vm.id
                                  ? "border-emerald-400/45 bg-emerald-400/12"
                                  : "border-transparent hover:border-white/10 hover:bg-white/5"
                              }`}
                            >
                              <div className="flex justify-center">
                                <span
                                  className={`h-3 w-3 rounded-full ${
                                    (vm.status?.toLowerCase?.() ?? "") === "up"
                                      ? "bg-emerald-400"
                                      : (vm.status?.toLowerCase?.() ?? "") === "down"
                                        ? "bg-amber-300"
                                        : "bg-sky-300"
                                  }`}
                                />
                              </div>
                            </button>
                          )),
                        ]
                      : inventoryTree.map((cluster) => {
                          const isOpen = expandedClusters[cluster.key] ?? true;
                          return (
                            <div
                              key={cluster.key}
                              className="rounded-xl border border-white/8 bg-black/20"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedClusters((prev) => ({
                                    ...prev,
                                    [cluster.key]: !isOpen,
                                  }))
                                }
                                className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition hover:bg-white/5"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="text-sm text-white/70">
                                    {isOpen ? "▾" : "▸"}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white">
                                      {cluster.label}
                                    </p>
                                    <p className="mt-1 text-xs text-white/45">
                                      {cluster.hosts.reduce((sum, host) => sum + host.vms.length, 0)} VMs · {cluster.up} up · {cluster.down} down
                                    </p>
                                  </div>
                                </div>
                                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-white/55">
                                  cluster
                                </span>
                              </button>

                              {isOpen && (
                                <div className="space-y-1 border-t border-white/6 px-2 py-2">
                                  {cluster.hosts.map((host) => {
                                    const hostOpen = expandedHosts[host.key] ?? true;
                                    return (
                                      <div key={host.key} className="rounded-xl border border-white/6 bg-white/[0.02]">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedHosts((prev) => ({
                                              ...prev,
                                              [host.key]: !hostOpen,
                                            }))
                                          }
                                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-white/5"
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className="text-xs text-white/65">
                                              {hostOpen ? "▾" : "▸"}
                                            </span>
                                            <div>
                                              <p className="text-sm font-medium text-white/90">
                                                {host.label}
                                              </p>
                                              <p className="text-xs text-white/45">
                                                {host.vms.length} VMs
                                              </p>
                                            </div>
                                          </div>
                                          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-white/45">
                                            host
                                          </span>
                                        </button>

                                        {hostOpen && (
                                          <div className="space-y-1 border-t border-white/6 px-2 py-2">
                                            {host.vms.map((vm) => (
                                              <button
                                                key={vm.id}
                                                type="button"
                                                onClick={() => setSelectedVmId(vm.id)}
                                                title={vm.name}
                                                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                                  selectedVmId === vm.id
                                                    ? "border-emerald-400/45 bg-emerald-400/12"
                                                    : "border-transparent hover:border-white/10 hover:bg-white/5"
                                                }`}
                                              >
                                                <div className="flex items-start gap-3">
                                                  <span className="mt-1 text-[11px] text-white/35">
                                                    └
                                                  </span>
                                                  <span
                                                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                                                      (vm.status?.toLowerCase?.() ?? "") === "up"
                                                        ? "bg-emerald-400"
                                                        : (vm.status?.toLowerCase?.() ?? "") === "down"
                                                          ? "bg-amber-300"
                                                          : "bg-sky-300"
                                                    }`}
                                                  />
                                                  <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-white">
                                                      {vm.name}
                                                    </p>
                                                    <p className="mt-1 truncate text-xs text-white/45">
                                                      {vm.template ?? "Template N/D"} · {vm.id}
                                                    </p>
                                                  </div>
                                                </div>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}

                    {loading && !sidebarCollapsed && (
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-4 text-sm text-white/50">
                        Cargando datos desde OLVM...
                      </div>
                    )}
                  </div>
                )}
              </nav>

              {!sidebarCollapsed && (
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                      Total
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-white">{totals.total}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-100/70">
                      Up
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-white">{totals.up}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-amber-100/70">
                      Down
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-white">{totals.down}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1780px] px-4 py-6 sm:px-6 lg:px-8">
            <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-emerald-500/5 backdrop-blur">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                    Portal de virtualizacion
                  </p>
                  <h1 className="text-3xl font-bold text-white sm:text-4xl">
                    Operacion de infraestructura OLVM
                  </h1>
                  <p className="max-w-3xl text-sm text-white/70">
                    Inventario fijo a la izquierda y operacion a la derecha, con
                    un patron cercano a los portales clasicos de virtualizacion.
                  </p>
                </div>
                <div className="flex flex-col items-start gap-3 xl:items-end">
                  <span className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-100">
                    Endpoint: ovirt-engine / REST
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-xs text-white/65">
                      Sesion:{" "}
                      <span className="font-semibold text-white">
                        {session?.user?.email ?? "desconocido"}
                      </span>
                    </div>
                    {(session?.user?.role === "admin" ||
                      session?.user?.role === "superadmin") && (
                      <Link
                        href="/admin/users"
                        className="rounded-full border border-sky-400/40 bg-sky-400/10 px-4 py-2 text-xs font-semibold text-sky-100 transition hover:-translate-y-0.5 hover:bg-sky-400/20"
                      >
                        Gestion de usuarios
                      </Link>
                    )}
                    <button
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="rounded-full border border-white/20 bg-white/8 px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {signingOut ? "Cerrando..." : "Cerrar sesion"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/60">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(58,212,173,0.18)]" />
                    Conexion autenticada por Basic Auth
                  </div>
                </div>
              </div>
            </header>

            <div className="mt-6 min-w-0 space-y-6">
            {error && (
              <div className="rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-50">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                {success}
              </div>
            )}
            {actionHistory.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/80">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                  Acciones recientes
                </p>
                <ul className="mt-2 space-y-1">
                  {actionHistory.map((entry) => (
                    <li
                      key={`${entry.vmId}-${entry.timestamp}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>
                        {entry.action} · {entry.vmId}
                      </span>
                      <span className="text-white/60">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={
                          entry.status === "ok"
                            ? "text-emerald-200"
                            : entry.status === "pending"
                              ? "text-amber-200"
                              : "text-red-200"
                        }
                      >
                        {entry.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr),420px]">
              <div className="space-y-6">
                {!selectedVm && tenantDashboardPanel}
                {selectedVm && (
                  <section className="rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/5 backdrop-blur">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/45">
                          Contexto activo
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <h2 className="text-2xl font-semibold text-white">
                            {selectedVm.name}
                          </h2>
                          <span className={statusBadge(selectedVm.status)}>
                            {selectedVm.status ?? "desconocido"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white/60">
                          {tenantName || "Tenant"} / {selectedVm.cluster || "Sin cluster"} / {selectedVm.host || "Host N/D"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedVmId("")}
                        className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10"
                      >
                        Limpiar seleccion
                      </button>
                    </div>
                  </section>
                )}
              </div>

              {detailPanel}
            </div>
          </div>
          </div>
        </main>
      </div>
      {cloneWizard.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-xl">
            <p className="text-xs uppercase tracking-wide text-white/50">
              Clone Wizard
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Clonar VM {cloneWizard.sourceVmName}
            </h2>
            <p className="mt-2 text-sm text-white/70">
              El clon copiará CPU, memoria y discos del servidor origen. Al terminar
              quedará apagado y con interfaces de red desconectadas.
            </p>
            <label className="mt-4 block text-sm text-white/70">
              Nuevo nombre
              <input
                value={cloneWizard.newName}
                onChange={(e) =>
                  setCloneWizard((prev) => ({
                    ...prev,
                    newName: e.target.value,
                    error: null,
                  }))
                }
                disabled={cloneWizard.submitting}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring disabled:opacity-70"
                placeholder="vm-clone-01"
              />
            </label>
            {cloneWizard.error && (
              <div className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {cloneWizard.error}
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={closeCloneWizard}
                disabled={cloneWizard.submitting}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={submitCloneWizard}
                disabled={cloneWizard.submitting}
                className="rounded-xl border border-emerald-400/40 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-400/25 disabled:opacity-60"
              >
                {cloneWizard.submitting ? "Clonando..." : "Clonar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showExperimentalConsole && embeddedConsole.status !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
          <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-white/50">
                  Consola embebida
                </p>
                <p className="text-lg font-semibold text-white">
                  VM {embeddedConsole.vmId}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={useProxy}
                    onChange={(e) => setUseProxy(e.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-transparent"
                  />
                  Usar proxy WS local
                </label>
                <ActionButton label="Cerrar" onClick={closeEmbeddedConsole} loading={false} />
              </div>
            </div>
            <div
              className="relative h-[70vh] w-full overflow-hidden rounded-xl border border-white/10 bg-black"
            >
              {embeddedConsole.iframeUrl ? (
                <iframe
                  src={embeddedConsole.iframeUrl}
                  className="h-full w-full border-0"
                  title={`Consola ${embeddedConsole.vmId}`}
                />
              ) : null}
              {embeddedConsole.status === "connecting" && !embeddedConsole.iframeUrl && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
                  Conectando consola…
                </div>
              )}
              {embeddedConsole.status === "error" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-red-200">
                  {embeddedConsole.error ?? "Error de consola"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
