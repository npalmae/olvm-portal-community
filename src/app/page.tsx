"use client";

import { useEffect, useMemo, useState } from "react";

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

type RfbCtor = typeof import("@novnc/novnc/core/rfb").default;
type RfbInstance = InstanceType<RfbCtor>;

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

const toGB = (mb?: number) => {
  if (!mb) return "—";
  return `${formatNumber(mb / 1024)} GB`;
};

const ActionButton = ({
  label,
  onClick,
  loading,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {loading ? "…" : label}
  </button>
);

export default function Home() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [vms, setVms] = useState<Vm[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [consoleLoading, setConsoleLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
  }>({ vmId: "", status: "idle", error: null, rfb: null });
  const [useProxy, setUseProxy] = useState(true);
  const consoleRef = useMemo(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.id = "embedded-console";
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

  const openConsoleWeb = async (vmId: string) => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    setConsoleLoading(vmId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/tenants/${selectedTenant}/vms/${vmId}/console/info?protocol=vnc`,
      );
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo obtener la consola web");
      const novncUrl = data?.novncUrl as string | undefined;
      if (novncUrl) {
        window.open(novncUrl, "_blank", "noopener,noreferrer");
        setSuccess("Consola abierta en nueva pestaña (noVNC).");
        return;
      }
      if (data?.websocket?.wsUrl && data?.ticket && data?.host) {
        const url = `${data.websocket.wsUrl}?host=${data.host}&port=${data.tlsPort ?? data.port ?? ""}&ticket=${data.ticket}`;
        window.open(url, "_blank", "noopener,noreferrer");
        setSuccess("Consola abierta usando proxy WebSocket.");
        return;
      }
      throw new Error("Respuesta de consola incompleta (host/port/ticket faltan).");
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

  const closeEmbeddedConsole = () => {
    embeddedConsole.rfb?.disconnect();
    setEmbeddedConsole({ vmId: "", status: "idle", error: null, rfb: null });
    if (consoleRef && consoleRef.parentElement) {
      consoleRef.replaceChildren();
    }
  };

  const openEmbeddedConsole = async (vmId: string) => {
    if (!selectedTenant || selectedTenant === "undefined" || !consoleRef) return;
    setEmbeddedConsole({ vmId, status: "connecting", error: null, rfb: null });
    setConsoleLoading(vmId);
    try {
      // Use dynamic eval import to avoid bundler parsing remote module.
      const origin =
        typeof window !== "undefined" && window.location.origin
          ? window.location.origin
          : "";
      const localUrl = origin
        ? `${origin}/novnc/rfb.js`
        : "/novnc/rfb.js";

      const mod = await (0, eval)(`import("${localUrl}")`);
      const RFB = (mod as { default?: RfbCtor }).default as RfbCtor | undefined;
      if (!RFB) throw new Error("No se pudo cargar noVNC");
      const infoRes = await fetch(
        `/api/tenants/${selectedTenant}/vms/${vmId}/console/info?protocol=vnc`,
      );
      const info = await parseJsonSafe(infoRes);
      if (!infoRes.ok || info?.error) {
        throw new Error(info?.error ?? "No se pudo obtener la consola");
      }

      let wsUrl: string;
      if (useProxy) {
        const proxyRes = await fetch(
          `/api/console/proxy?tenantId=${selectedTenant}&vmId=${vmId}&protocol=vnc`,
        );
        const proxy = await parseJsonSafe(proxyRes);
        if (!proxyRes.ok || proxy?.error || !proxy?.proxyWsUrl) {
          throw new Error(
            proxy?.error ?? "No se pudo preparar el proxy de consola",
          );
        }
        wsUrl = proxy.proxyWsUrl;
      } else if (info?.websocket?.wsUrl) {
        const host = info.host ?? "";
        const port = info.tlsPort ?? info.port ?? "";
        wsUrl = `${info.websocket.wsUrl}?host=${host}&port=${port}&ticket=${info.ticket ?? ""}`;
      } else if (info?.novncUrl) {
        wsUrl = info.novncUrl;
      } else {
        throw new Error("No hay websocket de consola disponible");
      }

      consoleRef.replaceChildren();
      const canvas = document.createElement("div");
      canvas.id = "novnc-canvas";
      canvas.className = "w-full h-full";
      consoleRef.appendChild(canvas);

      const rfb = new RFB(canvas, wsUrl, {
        credentials: { password: info.ticket ?? "" },
      });
      rfb.viewOnly = false;
      rfb.scaleViewport = true;
      rfb.addEventListener("connect", () =>
        setEmbeddedConsole((prev) => ({ ...prev, status: "connected" })),
      );
      rfb.addEventListener("disconnect", (evt: any) => {
        setEmbeddedConsole((prev) => ({
          ...prev,
          status: "error",
          error:
            (evt.detail?.clean === false && "Conexión cerrada inesperadamente") ||
            null,
        }));
      });
      setEmbeddedConsole({ vmId, status: "connected", error: null, rfb });
    } catch (err) {
      setEmbeddedConsole({
        vmId,
        status: "error",
        error: (err as Error).message,
        rfb: null,
      });
    } finally {
      setConsoleLoading(null);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-xl shadow-emerald-500/5 backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">
                OLVM multitenant
              </p>
              <h1 className="text-3xl font-bold text-white sm:text-4xl">
                Portal de administración
              </h1>
              <p className="max-w-2xl text-sm text-white/70">
                Gestiona VMs, arranques y recursos sobre OLVM/oVirt usando la API
                REST. Selecciona un tenant para filtrar los activos visibles por
                sus credenciales.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
              <span className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-100">
                Endpoint: ovirt-engine / REST
              </span>
              <div className="flex items-center gap-2 text-xs text-white/60">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(58,212,173,0.18)]" />
                Conexión autenticada por Basic Auth
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-sky-500/5 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">
                Tenant activo
              </p>
              <p className="text-xs text-white/70">
                Cada tenant usa sus credenciales y ve solo sus recursos.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedTenant}
                onChange={(e) => setSelectedTenant(e.target.value)}
                className="w-64 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white outline-none ring-emerald-400/30 focus:ring-2"
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
              <button
                onClick={refresh}
                className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:-translate-y-0.5 hover:bg-emerald-400/15"
              >
                Refrescar VMs
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-50">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-6 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
        {success}
      </div>
    )}
        {actionHistory.length > 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/80">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              Acciones recientes
            </p>
            <ul className="mt-2 space-y-1">
              {actionHistory.map((entry) => (
                <li key={`${entry.vmId}-${entry.timestamp}`} className="flex items-center justify-between gap-3">
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

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/60">Total VMs</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.total}</p>
            <p className="text-xs text-white/50">Visibles para {tenantName}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4">
            <p className="text-xs text-emerald-100">Encendidas</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.up}</p>
            <p className="text-xs text-emerald-100/70">
              Estados reportados como &quot;up&quot;
            </p>
          </div>
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4">
            <p className="text-xs text-amber-100">Apagadas / detenido</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.down}</p>
            <p className="text-xs text-amber-100/80">Incluye transiciones</p>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr,1fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Máquinas virtuales</p>
                <p className="text-xs text-white/60">
                  Arranca, detén y ajusta recursos. Las acciones se envían al motor
                  OLVM.
                </p>
              </div>
              {loading && (
                <span className="text-xs text-white/60">Cargando VMs…</span>
              )}
            </div>
            <div className="mt-4 space-y-4">
              {vms.length === 0 && !loading && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  No hay VMs visibles para este tenant.
                </div>
              )}
              {vms.map((vm) => (
                <div
                  key={vm.id}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/8 to-white/3 p-4 shadow-inner shadow-black/20"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-lg font-semibold text-white">{vm.name}</p>
                        <span className={statusBadge(vm.status)}>
                          {vm.status ?? "desconocido"}
                        </span>
                      </div>
                      <p className="text-xs text-white/60">
                        ID: {vm.id} · Cluster: {vm.cluster ?? "N/D"} · Host:{" "}
                        {vm.host ?? "N/D"} · Template: {vm.template ?? "N/D"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        label="Start"
                        onClick={() => runAction(vm.id, "start")}
                        loading={actionLoading === `${vm.id}-start`}
                      />
                      <ActionButton
                        label="Stop"
                        onClick={() => runAction(vm.id, "stop")}
                        loading={actionLoading === `${vm.id}-stop`}
                      />
                      <ActionButton
                        label="Shutdown"
                        onClick={() => runAction(vm.id, "shutdown")}
                        loading={actionLoading === `${vm.id}-shutdown`}
                      />
                      <ActionButton
                        label="Reboot"
                        onClick={() => runAction(vm.id, "reboot")}
                        loading={actionLoading === `${vm.id}-reboot`}
                      />
                      <ActionButton
                        label="Consola (VNC)"
                        onClick={() => downloadConsole(vm.id, "vnc")}
                        loading={consoleLoading === vm.id}
                      />
                      <ActionButton
                        label="Consola web"
                        onClick={() => openConsoleWeb(vm.id)}
                        loading={consoleLoading === vm.id}
                      />
                      <ActionButton
                        label="Consola embebida"
                        onClick={() => openEmbeddedConsole(vm.id)}
                        loading={consoleLoading === vm.id}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                    <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                      <p className="text-xs text-white/50">CPU</p>
                      <p className="text-lg font-semibold text-white">
                        {formatNumber(vm.metrics?.cpuPercent)}%
                      </p>
                      <UsageBar value={vm.metrics?.cpuPercent} />
                      <p className="text-xs text-white/50">
                        Topología: {vm.cpuCores ?? "?"} vCPU · {vm.sockets ?? 1} socket
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                      <p className="text-xs text-white/50">Memoria</p>
                      <p className="text-lg font-semibold text-white">
                        {toGB(vm.memoryMB)}
                      </p>
                      <UsageBar value={vm.metrics?.memoryPercent} />
                      <p className="text-xs text-white/50">
                        Uso: {formatNumber(vm.metrics?.memoryPercent)}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                      <p className="text-xs text-white/50">Disco</p>
                      <p className="text-lg font-semibold text-white">
                        R {formatNumber(vm.metrics?.diskReadBytes, {
                          notation: "compact",
                        })}{" "}
                        · W{" "}
                        {formatNumber(vm.metrics?.diskWriteBytes, {
                          notation: "compact",
                        })}
                      </p>
                      <UsageBar
                        value={
                          vm.metrics?.diskReadBytes || vm.metrics?.diskWriteBytes
                            ? 100
                            : 0
                        }
                      />
                      <p className="text-xs text-white/50">bytes/seg (última muestra)</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                      <p className="text-xs text-white/50">Red</p>
                      <p className="text-lg font-semibold text-white">
                        {formatNumber(vm.metrics?.networkBytes, {
                          notation: "compact",
                        })}
                      </p>
                      <UsageBar value={vm.metrics?.networkBytes ? 100 : 0} />
                      <p className="text-xs text-white/50">bytes combinados</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-white/60">
                        Memoria (MB)
                        <input
                          type="number"
                          min={512}
                          value={resourceDrafts[vm.id]?.memoryMB ?? ""}
                          onChange={(e) =>
                            setResourceDrafts((prev) => ({
                              ...prev,
                              [vm.id]: {
                                ...prev[vm.id],
                                memoryMB: e.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-white/60">
                        vCPU
                        <input
                          type="number"
                          min={1}
                          value={resourceDrafts[vm.id]?.cpuCores ?? ""}
                          onChange={(e) =>
                            setResourceDrafts((prev) => ({
                              ...prev,
                              [vm.id]: {
                                ...prev[vm.id],
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
                          value={resourceDrafts[vm.id]?.sockets ?? ""}
                          onChange={(e) =>
                            setResourceDrafts((prev) => ({
                              ...prev,
                              [vm.id]: {
                                ...prev[vm.id],
                                sockets: e.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                        />
                      </label>
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => updateResources(vm.id)}
                        disabled={actionLoading === `${vm.id}-update`}
                        className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:bg-emerald-400/25 disabled:opacity-60"
                      >
                        {actionLoading === `${vm.id}-update`
                          ? "Actualizando…"
                          : "Actualizar recursos"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
                  Cargando datos desde OLVM…
                </div>
              )}
            </div>
          </section>

          <aside className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Crear nueva VM</p>
                <p className="text-xs text-white/60">
                  Usa IDs de cluster / template disponibles en OLVM.
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
                {actionLoading === "create" ? "Creando…" : "Crear VM"}
              </button>
              <p className="text-xs text-white/50">
                Para multitenancy agrega más entradas en OLVM_TENANTS y aparecerán
                aquí. Las credenciales nunca salen del servidor.
              </p>
            </div>
          </aside>
        </div>
      </div>
      {embeddedConsole.status !== "idle" && (
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
              ref={(el) => {
                if (el && consoleRef && !el.contains(consoleRef)) {
                  el.appendChild(consoleRef);
                }
              }}
            >
              {embeddedConsole.status === "connecting" && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                  Conectando consola…
                </div>
              )}
              {embeddedConsole.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-red-200">
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
