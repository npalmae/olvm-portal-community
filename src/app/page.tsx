"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { usePortalBranding } from "@/components/usePortalBranding";
import { SixmanagerMark } from "@/components/SixmanagerMark";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import { dashboardMessages } from "@/i18n/dashboard";

/* ── Types ────────────────────────────────────────────────────────────── */

type Tenant = { id: string; name: string; baseUrl: string; brandName?: string; brandLogoUrl?: string };
type MembershipRole = "operator" | "user" | "admin";

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
  tenantId?: string;
  tenantName?: string;
  os?: string;
  ip?: string;
  tags?: string[];
  metrics?: {
    cpuPercent?: number;
    memoryPercent?: number;
    diskReadBytes?: number;
    diskWriteBytes?: number;
    networkBytes?: number;
  };
};

const ALL_TENANTS = "__all__";

type VmDraft = { memoryMB?: string; cpuCores?: string; sockets?: string };

type NewVmDraft = {
  name: string; clusterId: string; templateId: string;
  memoryMB: string; cpuCores: string; sockets: string; comment: string;
  os: string; vnicProfileId: string;
};

type ActionLog = {
  vmId: string; action: string;
  status: "pending" | "ok" | "error";
  timestamp: number; message?: string;
};

type CloneJob = {
  id: string; tenantId: string; action: string; targetVmId?: string; targetVmName?: string; requestedBy: string; requesterLabel?: string; origin: "portal" | "api";
  status: "queued" | "running" | "completed" | "failed"; stage: string; progress: number; error?: string | null; finishedAt?: string | null;
};

type RfbCtor = any;
type RfbInstance = any;

/* ── Helpers ──────────────────────────────────────────────────────────── */

const clampPercent = (v?: number) =>
  v === undefined || Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, v));

const formatLocaleNumber = (locale: string, value?: number, opts: Intl.NumberFormatOptions = {}) => {
  if (value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, ...opts }).format(value);
};

const formatLocaleBytes = (locale: string, value?: number) => {
  if (value === undefined || Number.isNaN(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value, ui = 0;
  while (size >= 1024 && ui < units.length - 1) { size /= 1024; ui++; }
  return `${formatLocaleNumber(locale, size, { maximumFractionDigits: size >= 100 ? 0 : 1 })} ${units[ui]}`;
};

const toLocaleGB = (locale: string, mb?: number) => mb ? `${formatLocaleNumber(locale, mb / 1024)} GB` : "—";

const parseJsonSafeResponse = async (res: Response, unexpectedResponse: string) => {
  const text = await res.text();
  const t = text.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html"))
    return { error: unexpectedResponse };
  try { return text ? JSON.parse(text) : null; }
  catch { return text ? { error: text } : null; }
};

/* ── Mini components ──────────────────────────────────────────────────── */

const StatusDot = ({ status }: { status: string }) => {
  const s = status?.toLowerCase() ?? "";
  const cls =
    s === "up" ? "bg-emerald-500" :
    s === "down" || s === "stopped" ? "bg-amber-400" :
    "bg-sky-400";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${cls}`} />;
};

const StatusBadge = ({ status }: { status: string }) => {
  const s = status?.toLowerCase() ?? "";
  if (s === "up")
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />up
    </span>;
  if (s === "down" || s === "stopped")
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{s}
    </span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{status}
  </span>;
};

const MiniBar = ({ value, color = "bg-blue-500" }: { value?: number; color?: string }) => {
  const pct = clampPercent(value);
  const missing = value === undefined || Number.isNaN(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color} ${missing ? "opacity-30" : ""}`}
          style={{ width: missing ? "8%" : `${Math.max(3, pct)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] text-gray-500 tabular-nums">
        {missing ? "—" : `${pct.toFixed(0)}%`}
      </span>
    </div>
  );
};

const DonutRing = ({
  value, color, size = 56,
}: { value?: number; color: string; size?: number }) => {
  const pct = clampPercent(value);
  const r = 20, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
      <circle
        cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 24 24)" className="transition-all duration-500"
      />
      <text x="24" y="28" textAnchor="middle"
        fontSize="10" fontWeight="600" fill="#374151">
        {value === undefined || Number.isNaN(value) ? "—" : `${pct.toFixed(0)}%`}
      </text>
    </svg>
  );
};

/* ── Stat card ────────────────────────────────────────────────────────── */
const StatCard = ({
  label, value, sub, accent = false, warning = false,
}: { label: string; value: string | number; sub?: string; accent?: boolean; warning?: boolean }) => (
  <div className={`rounded-lg border p-3 ${
    accent ? "border-blue-200 bg-blue-50" :
    warning ? "border-amber-200 bg-amber-50" :
    "border-[--border] bg-white"
  }`}>
    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
    <p className={`mt-1 text-2xl font-bold tabular-nums ${
      accent ? "text-blue-700" : warning ? "text-amber-700" : "text-gray-900"
    }`}>{value}</p>
    {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
  </div>
);

/* ── Action button ────────────────────────────────────────────────────── */
const ActionButton = ({
  label, onClick, loading, disabled = false, title, variant = "default",
}: {
  label: string; onClick: () => void; loading: boolean;
  disabled?: boolean; title?: string;
  variant?: "default" | "primary" | "danger";
}) => {
  const base = "rounded-md border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 hover:-translate-y-px";
  const cls =
    variant === "primary"
      ? `${base} border-blue-300 bg-blue-600 text-white hover:bg-blue-700`
      : variant === "danger"
      ? `${base} border-red-300 bg-red-50 text-red-700 hover:bg-red-100`
      : `${base} border-[--border] bg-white text-gray-700 hover:bg-gray-50`;
  return (
    <button onClick={onClick} disabled={loading || disabled} title={title} className={cls}>
      {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : label}
    </button>
  );
};

const Field = ({
  label, children,
}: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

const inputCls = "w-full rounded-md border border-[--border] bg-white px-2.5 py-1.5 text-xs text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400";

/* ════════════════════════════════════════════════════════════════════════
   Main component
   ════════════════════════════════════════════════════════════════════════ */

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  const { locale } = useLocale();
  const t = useTranslations(dashboardMessages);
  const formatNumber = (value?: number, opts: Intl.NumberFormatOptions = {}) => formatLocaleNumber(locale, value, opts);
  const formatBytes = (value?: number) => formatLocaleBytes(locale, value);
  const toGB = (value?: number) => toLocaleGB(locale, value);
  const parseJsonSafe = (res: Response) => parseJsonSafeResponse(res, t("unexpectedServerResponse"));
  const actionLabel = (action: string) => ({
    start: t("start"), stop: t("stop"), shutdown: t("shutdown"), reboot: t("reboot"),
  }[action] ?? action);
  const { branding: portalBranding } = usePortalBranding();
  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";
  const showExperimentalConsole = true;

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [vms, setVms] = useState<Vm[]>([]);
  const [selectedVmId, setSelectedVmId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [consoleLoading, setConsoleLoading] = useState<string | null>(null);
  const [consolePreviewIframe, setConsolePreviewIframe] = useState<string | null>(null);
  const [consolePreviewLoading, setConsolePreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inventoryExpanded, setInventoryExpanded] = useState(true);
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});
  const [expandedTenants, setExpandedTenants] = useState<Record<string, boolean>>({});
  const [vmDisks, setVmDisks] = useState<{
    count: number;
    totalSizeGB: number;
    usedGB: number;
    disks: { name?: string; sizeGB: number; usedGB?: number }[];
  } | null>(null);
  const [tenantDiskMap, setTenantDiskMap] = useState<Record<string, { totalSizeGB: number; usedGB: number; count: number }>>({});
  const [storageDomains, setStorageDomains] = useState<{ id: string; name: string; type: string; status?: string; availableGB: number; usedGB: number; totalGB: number }[]>([]);
  const [showAllSds, setShowAllSds] = useState(false);
  const [isoList, setIsoList] = useState<{ id: string; name: string; storageDomainName: string; sizeGB: number }[]>([]);
  const [mountedIso, setMountedIso] = useState<string | null>(null);
  const [newDiskSize, setNewDiskSize] = useState("50");
  const [newDiskSd, setNewDiskSd] = useState("");
  const [newDiskIface, setNewDiskIface] = useState("virtio_scsi");
  const [vmDiskList, setVmDiskList] = useState<{ attachmentId: string; diskId: string; name: string; sizeGB: number; interface: string; bootable: boolean; status: string }[]>([]);
  const [uploadingIso, setUploadingIso] = useState(false);
  const [uploadingOva, setUploadingOva] = useState(false);
  const [ovaUploadProgress, setOvaUploadProgress] = useState<number | null>(null);
  const [uploadedOva, setUploadedOva] = useState<{ uploadId?: string; diskId?: string; name: string; ovf?: string } | null>(null);
  const [ovaStorageDomainId, setOvaStorageDomainId] = useState("");
  const [ovaHostId, setOvaHostId] = useState("");
  const [ovaImportProgress, setOvaImportProgress] = useState<number | null>(null);
  const [ovaLibrary, setOvaLibrary] = useState<{ id: string; name: string; size: number; storageDomainName?: string }[]>([]);
  const [newVmSource, setNewVmSource] = useState<"blank" | "template" | "ova">("blank");
  const [detailTab, setDetailTab] = useState<"overview" | "actions" | "resources" | "provisioning" | "console">("overview");
  const [resourceDrafts, setResourceDrafts] = useState<Record<string, VmDraft>>({});
  const [newVm, setNewVm] = useState<NewVmDraft>({
    name: "", clusterId: "", templateId: "",
    memoryMB: "", cpuCores: "", sockets: "1", comment: "",
    os: "linux", vnicProfileId: "",
  });
  const [cloudInit, setCloudInit] = useState({ ip: "", netmask: "", gateway: "", dns: "" });
  const [useCloudInit, setUseCloudInit] = useState(false);
  const [vmNics, setVmNics] = useState<{ id: string; name: string; mac: string; linked: boolean; plugged: boolean; interface: string; networkName: string; vnicProfileId: string; ipv4?: string }[]>([]);
  const [provClusters, setProvClusters] = useState<{ id: string; name: string }[]>([]);
  const [provTemplates, setProvTemplates] = useState<{ id: string; name: string }[]>([]);
  const [provNetworks, setProvNetworks] = useState<{ id: string; name: string }[]>([]);
  const [provVnicProfiles, setProvVnicProfiles] = useState<{ id: string; name: string; networkId: string; networkName: string }[]>([]);
  const [provHosts, setProvHosts] = useState<{ id: string; name: string; address?: string }[]>([]);
  const [netConfig, setNetConfig] = useState<Record<string, { prefix: string; mask: string }>>({});
  const [actionHistory, setActionHistory] = useState<ActionLog[]>([]);
  const [embeddedConsole, setEmbeddedConsole] = useState<{
    vmId: string; status: "idle" | "connecting" | "connected" | "error";
    error?: string | null; rfb?: RfbInstance | null; iframeUrl?: string | null;
  }>({ vmId: "", status: "idle", error: null, rfb: null });
  const [useProxy, setUseProxy] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [cloneWizard, setCloneWizard] = useState<{
    open: boolean; sourceVmId: string; sourceVmName: string;
    newName: string; submitting: boolean; error: string | null;
  }>({ open: false, sourceVmId: "", sourceVmName: "", newName: "", submitting: false, error: null });
  const [cloneJobs, setCloneJobs] = useState<CloneJob[]>([]);
  const knownCloneStatuses = useRef<Record<string, string>>({});

  const [powerTransition, setPowerTransition] = useState<{ vmId: string; action: string } | null>(null);
  const powerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const closingConsole = useRef(false);
  const embeddedConsoleSession = useRef(0);
  const consoleRef = useMemo(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.id = "embedded-console";
    Object.assign(div.style, { width: "100%", height: "100%", position: "relative", overflow: "hidden" });
    return div;
  }, []);

  const capabilityTenantId = selectedTenant === ALL_TENANTS
    ? vms.find((vm) => vm.id === selectedVmId)?.tenantId ?? ""
    : selectedTenant;
  const activeTenantRole = session?.user?.memberships?.find(
    (membership) => membership.tenantId === capabilityTenantId,
  )?.role as MembershipRole | undefined;
  const activeRoleRank = activeTenantRole === "admin" ? 2 : activeTenantRole === "user" ? 1 : 0;
  const canRead = isSuperadmin || Boolean(activeTenantRole);
  const canOperate = isSuperadmin || activeRoleRank >= 1;
  const canAdmin = isSuperadmin || activeRoleRank >= 2;

  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (data.setupComplete === false) router.push("/setup"); })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    const authorized = detailTab === "overview"
      || ((detailTab === "actions" || detailTab === "console") && canOperate)
      || ((detailTab === "resources" || detailTab === "provisioning") && canRead);
    if (!authorized) setDetailTab("overview");
    if (!canOperate) {
      setConsolePreviewIframe(null);
      setConsolePreviewLoading(false);
    }
  }, [canOperate, canRead, detailTab, capabilityTenantId]);

  /* ── Stop power transition polling when VM stabilizes ── */
  useEffect(() => {
    if (!powerTransition || !vms.length) return;
    const vm = vms.find((v) => v.id === powerTransition.vmId);
    if (!vm) return;
    const status = vm.status?.toLowerCase() ?? "";
    const target = powerTransition.action === "stop" ? "down" : "up";
    if (status === target) {
      if (powerPollRef.current) { clearInterval(powerPollRef.current); powerPollRef.current = null; }
      setPowerTransition(null);
      setSuccess(powerTransition.action === "stop" ? t("vmPoweredOff") : t("vmPoweredOn"));
    }
  }, [powerTransition, vms]);

  useEffect(() => () => { if (powerPollRef.current) clearInterval(powerPollRef.current); }, []);

  /* ── Auto-clear toasts ── */
  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => { setError(null); setSuccess(null); }, 6000);
    return () => clearTimeout(t);
  }, [error, success]);

  /* ── Load tenants ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tenants");
        const data = await parseJsonSafe(res);
        if (!res.ok) throw new Error(data?.error ?? t("tenantsLoadFailed"));
        if (!Array.isArray(data) || !data.length) throw new Error(t("noTenants"));
        const s = data.filter((t) => Boolean(t.id));
        setTenants(s);
        // Superadmin arranca en vista "Todos los tenants"
        setSelectedTenant(
          session?.user?.role === "superadmin" && s.length > 1 ? ALL_TENANTS : s[0]?.id ?? "",
        );
      } catch (err) { setError(t("tenantsOlvmError")); }
    })();
  }, [session?.user?.role]);

  useEffect(() => {
    if (!tenants.length) return;
    const first = tenants[0]?.id;
    const invalid =
      !selectedTenant ||
      selectedTenant === "undefined" ||
      (selectedTenant !== ALL_TENANTS && !tenants.some((t) => t.id === selectedTenant));
    if (invalid && first) setSelectedTenant(first);
  }, [selectedTenant, tenants]);

  /* ── Load VMs ── */
  const loadVms = async (tenantId: string) => {
    setLoading(true); setError(null);
    try {
      if (tenantId === ALL_TENANTS) {
        // Vista "Todos": junta las VMs de cada tenant en paralelo
        const perTenant = await Promise.all(
          tenants.map(async (t) => {
            try {
              const res = await fetch(`/api/tenants/${t.id}/vms`);
              const data = await parseJsonSafe(res);
              if (!res.ok) return [] as Vm[];
              return (Array.isArray(data) ? (data as Vm[]) : []).map((v) => ({
                ...v,
                tenantId: t.id,
                tenantName: t.name,
              }));
            } catch {
              return [] as Vm[];
            }
          }),
        );
        setVms(perTenant.flat());
      } else {
        const res = await fetch(`/api/tenants/${tenantId}/vms`);
        const data = await parseJsonSafe(res);
        if (!res.ok) throw new Error(data?.error ?? t("vmsLoadFailed"));
        const tenant = tenants.find((x) => x.id === tenantId);
        setVms(
          (Array.isArray(data) ? (data as Vm[]) : []).map((v) => ({
            ...v,
            tenantId,
            tenantName: tenant?.name,
          })),
        );
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  // Tenant efectivo de una VM (para operar en vista "Todos")
  const tenantForVm = (vmId: string) => {
    const vm = vms.find((v) => v.id === vmId);
    if (vm?.tenantId) return vm.tenantId;
    return selectedTenant === ALL_TENANTS ? "" : selectedTenant;
  };

  useEffect(() => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    loadVms(selectedTenant);
  }, [selectedTenant]);

  useEffect(() => {
    if (!vms.length) { setSelectedVmId(""); return; }
    if (selectedVmId && !vms.some((vm) => vm.id === selectedVmId)) setSelectedVmId("");
  }, [selectedVmId, vms]);

  const refresh = () => {
    if (!selectedTenant || selectedTenant === "undefined") return;
    loadVms(selectedTenant);
  };

  useEffect(() => {
    if (!selectedTenant || selectedTenant === "undefined" || !tenants.length) return;
    let cancelled = false;
    const poll = async () => {
      const tenantIds = selectedTenant === ALL_TENANTS ? tenants.map((tenant) => tenant.id) : [selectedTenant];
      const jobs = (await Promise.all(tenantIds.map(async (tenantId) => {
        try {
           const response = await fetch(`/api/tenants/${tenantId}/operation-jobs?limit=25`, { cache: "no-store" });
          const data = await parseJsonSafe(response);
          return response.ok && Array.isArray(data) ? data as CloneJob[] : [];
        } catch { return [] as CloneJob[]; }
      }))).flat();
      if (cancelled) return;
      const completed = jobs.some((job) => knownCloneStatuses.current[job.id]
        && knownCloneStatuses.current[job.id] !== "completed" && job.status === "completed");
      knownCloneStatuses.current = Object.fromEntries(jobs.map((job) => [job.id, job.status]));
      const recentCutoff = Date.now() - 45_000;
      setCloneJobs(jobs.filter((job) => job.status === "queued" || job.status === "running"
        || (job.finishedAt && new Date(job.finishedAt).getTime() >= recentCutoff)));
      if (completed) loadVms(selectedTenant);
    };
    void poll();
    const interval = setInterval(() => void poll(), 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedTenant, tenants]);

  // Carga storage domains del tenant actual
  useEffect(() => {
    setStorageDomains([]);
    if (!selectedTenant || selectedTenant === "undefined" || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = showAllSds ? "?all=1" : "";
        const res = await fetch(`/api/tenants/${selectedTenant}/storage-domains${qs}`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && Array.isArray(data)) setStorageDomains(data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant, showAllSds]);

  useEffect(() => {
    if (ovaStorageDomainId && storageDomains.some((sd) => sd.id === ovaStorageDomainId)) return;
    const activeDataDomain = storageDomains.find(
      (sd) => sd.type === "data" && (!sd.status || sd.status.toLowerCase() === "active"),
    );
    setOvaStorageDomainId(activeDataDomain?.id ?? "");
  }, [ovaStorageDomainId, storageDomains]);

  useEffect(() => {
    if (ovaHostId && provHosts.some((h) => h.id === ovaHostId)) return;
    setOvaHostId(provHosts[0]?.id ?? "");
  }, [ovaHostId, provHosts]);

  // Carga ISOs del tenant actual
  useEffect(() => {
    setIsoList([]);
    if (!selectedTenant || selectedTenant === "undefined" || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/isos`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && Array.isArray(data)) setIsoList(data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant]);

  // Carga ISO montada cuando se selecciona una VM
  useEffect(() => {
    setMountedIso(null);
    if (!selectedVmId || !selectedTenant || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/vms/${selectedVmId}/cdrom`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && data?.isoId) setMountedIso(data.isoId);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedVmId, selectedTenant]);

  // Carga clusters y templates disponibles para el form de nueva VM
  useEffect(() => {
    setProvClusters([]);
    setProvTemplates([]);
    setProvNetworks([]);
    setProvVnicProfiles([]);
    setProvHosts([]);
    if (!selectedTenant || selectedTenant === "undefined" || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/provisioning-options`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && data) {
          if (Array.isArray(data.clusters)) setProvClusters(data.clusters);
          if (Array.isArray(data.templates)) setProvTemplates(data.templates);
          if (Array.isArray(data.networks)) setProvNetworks(data.networks);
          if (Array.isArray(data.vnicProfiles)) setProvVnicProfiles(data.vnicProfiles);
          if (Array.isArray(data.hosts)) setProvHosts(data.hosts);
          if (Array.isArray(data.networkConfig)) {
            const nc: Record<string, { prefix: string; mask: string }> = {};
            for (const n of data.networkConfig) { nc[n.name] = { prefix: n.prefix, mask: n.mask }; }
            setNetConfig(nc);
          }
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant]);

  // Carga catálogo de OVAs del tenant
  useEffect(() => {
    setOvaLibrary([]);
    if (!selectedTenant || selectedTenant === "undefined" || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/ova/library`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && Array.isArray(data)) setOvaLibrary(data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant]);

  // Carga discos de la VM seleccionada
  useEffect(() => {
    setVmDiskList([]);
    if (!selectedVmId || !selectedTenant || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/vms/${selectedVmId}/disk`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && Array.isArray(data)) setVmDiskList(data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedVmId, selectedTenant]);

  // Carga NICs de la VM seleccionada
  useEffect(() => {
    setVmNics([]);
    if (!selectedVmId || !selectedTenant || selectedTenant === ALL_TENANTS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${selectedTenant}/vms/${selectedVmId}/nics`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && Array.isArray(data)) setVmNics(data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [selectedVmId, selectedTenant]);

  // Default interface based on OS
  useEffect(() => {
    setNewDiskIface(newVm.os === "windows" ? "sata" : "virtio_scsi");
  }, [newVm.os]);

  const tenantName = useMemo(
    () =>
      selectedTenant === ALL_TENANTS
        ? t("allTenants")
        : (tenants.find((t) => t.id === selectedTenant)?.name ?? ""),
    [selectedTenant, tenants, locale],
  );

  /* ── Actions ── */
  const runAction = async (vmId: string, action: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-${action}`); setError(null); setSuccess(null);
    const ts = Date.now();
    setActionHistory((p) => [{ vmId, action, status: "pending", timestamp: ts }, ...p.slice(0, 2)]);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("actionFailed"));
      setSuccess(t("actionSent", { action: actionLabel(action) }));
      setActionHistory((p) => p.map((e) => e.vmId === vmId && e.timestamp === ts ? { ...e, status: "ok" } : e));
      refresh();
      if (action === "start" || action === "stop" || action === "reboot") {
        setPowerTransition({ vmId, action });
        if (powerPollRef.current) clearInterval(powerPollRef.current);
        powerPollRef.current = setInterval(() => { loadVms(selectedTenant); }, 3000);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      setActionHistory((p) => p.map((e) => e.vmId === vmId && e.timestamp === ts ? { ...e, status: "error", message: msg } : e));
    } finally { setActionLoading(null); }
  };

  const openCloneWizard = (vm: Vm) => setCloneWizard({
    open: true, sourceVmId: vm.id, sourceVmName: vm.name,
    newName: `${vm.name}-clone`, submitting: false, error: null,
  });

  const toggleTag = async (vmId: string, assign: boolean) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-tag`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/tag`, { method: assign ? "POST" : "DELETE" });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(assign ? t("tagAssigned") : t("tagRemoved"));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMountIso = async (vmId: string, isoId: string | null) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-iso`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/cdrom`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isoId ? { isoId } : {}),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setMountedIso(isoId);
      setSuccess(isoId ? t("isoMounted") : t("isoUnmounted"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddDisk = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-disk`);
    try {
      const sdId = newDiskSd || storageDomains[0]?.id;
      if (!sdId) throw new Error(t("noStorageDomains"));
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/disk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sizeGB: Number(newDiskSize) || 50, storageDomainId: sdId, interface: newDiskIface }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("diskCreated", { size: newDiskSize, interface: newDiskIface }));
      const res2 = await fetch(`/api/tenants/${tid}/vms/${vmId}/disk`);
      const d2 = await parseJsonSafe(res2);
      if (Array.isArray(d2)) setVmDiskList(d2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteDisk = async (vmId: string, attachmentId: string, diskId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-del-disk`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/disk?attachmentId=${attachmentId}&diskId=${diskId}`, {
        method: "DELETE",
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("diskDeleted"));
      setVmDiskList(vmDiskList.filter((d) => d.attachmentId !== attachmentId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddNic = async (vmId: string, vnicProfileId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-nic`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/nics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vnicProfileId }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("nicAdded"));
      const res2 = await fetch(`/api/tenants/${tid}/vms/${vmId}/nics`);
      const d2 = await parseJsonSafe(res2);
      if (Array.isArray(d2)) setVmNics(d2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleNic = async (vmId: string, nicId: string, turnOn: boolean) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-nic`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/nics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nicId, linked: turnOn }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(turnOn ? t("nicConnected") : t("nicDisconnected"));
      setVmNics(vmNics.map((n) => n.id === nicId ? { ...n, linked: turnOn, plugged: turnOn } : n));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteNic = async (vmId: string, nicId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-nic`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/nics?nicId=${nicId}`, {
        method: "DELETE",
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("nicDeleted"));
      setVmNics(vmNics.filter((n) => n.id !== nicId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunOnceCd = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-run_once`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_once_cd" }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("vmStartedFromCd"));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteVm = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setActionLoading(`${vmId}-delete`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}`, { method: "DELETE" });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("vmDeleted"));
      setSelectedVmId("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUploadIso = async (file: File) => {
    const tid = selectedTenant;
    if (!tid || tid === ALL_TENANTS) return;
    const sd = storageDomains[0];
    if (!sd) { setError(t("noIsoStorage")); return; }
    setUploadingIso(true);
    setError(null);
    setSuccess(null);
    setUploadFileName(file.name);
    setUploadProgress(0);
    try {
      const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // 1. Iniciar sesión de upload
      const initRes = await fetch(`/api/tenants/${tid}/isos/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
          "x-file-size": String(file.size),
          "x-storage-domain-id": sd.id,
        },
        body: new Uint8Array(0),
      });
      const initData = await parseJsonSafe(initRes);
      if (!initRes.ok) throw new Error(initData?.error ?? t("uploadStartFailed"));
      const sessionId = initData.sessionId;

      // 2. Subir chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const chunkRes = await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const chunkProgress = e.loaded / e.total;
              const overall = ((i + chunkProgress) / totalChunks) * 100;
              setUploadProgress(Math.round(overall));
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(new Response(xhr.responseText, { status: xhr.status }));
            } else {
              try {
                const d = JSON.parse(xhr.responseText);
                reject(new Error(d?.error ?? t("chunkHttpError", { status: xhr.status, chunk: i + 1 })));
              } catch { reject(new Error(t("chunkHttpError", { status: xhr.status, chunk: i + 1 }))); }
            }
          });
          xhr.addEventListener("error", () => reject(new Error(t("networkChunkError", { chunk: i + 1, total: totalChunks }))));
          xhr.addEventListener("abort", () => reject(new Error(t("uploadCancelled"))));
          xhr.open("POST", `/api/tenants/${tid}/isos/upload`);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("x-chunk-index", String(i));
          xhr.setRequestHeader("x-total-chunks", String(totalChunks));
          xhr.setRequestHeader("x-session-id", sessionId);
          xhr.send(chunk);
        });

        const chunkData = await parseJsonSafe(chunkRes);
        if (chunkData?.done) {
          setUploadProgress(100);
          break;
        }
      }

      setSuccess(t("isoUploadSuccess", { name: file.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingIso(false);
      setUploadProgress(null);
      setUploadFileName("");
    }
  };

  const handleUploadOva = async (file: File) => {
    const tid = selectedTenant;
    if (!tid || tid === ALL_TENANTS) return;
    setUploadingOva(true); setOvaUploadProgress(0); setError(null); setSuccess(null);
    try {
      const chunkSize = 50 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const initRes = await fetch(`/api/tenants/${tid}/ova/upload`, {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name), "x-file-size": String(file.size) },
      });
      const init = await parseJsonSafe(initRes);
      if (!initRes.ok) throw new Error(init?.error ?? t("ovaUploadStartFailed"));
      let completed: { uploadId?: string; ovf?: string } | null = null;
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
        const res = await fetch(`/api/tenants/${tid}/ova/upload`, {
          method: "POST", body: chunk,
          headers: { "Content-Type": "application/octet-stream", "x-chunk-index": String(i), "x-session-id": init.sessionId },
        });
        const data = await parseJsonSafe(res);
        if (!res.ok) throw new Error(data?.error ?? t("blockError", { block: i + 1 }));
        if (data?.done) completed = data;
        setOvaUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
      if (!completed?.uploadId) throw new Error(t("ovaNotConfirmed"));
      setUploadedOva({ uploadId: completed.uploadId, name: file.name, ovf: completed.ovf ?? "" });
      setSuccess(t("ovaUploadSuccess", { name: file.name }));
    } catch (err) { setError((err as Error).message); }
    finally { setUploadingOva(false); setTimeout(() => setOvaUploadProgress(null), 1000); }
  };

  const closeCloneWizard = () => {
    if (cloneWizard.submitting) return;
    setCloneWizard({ open: false, sourceVmId: "", sourceVmName: "", newName: "", submitting: false, error: null });
  };

  const submitCloneWizard = async () => {
    const tid = tenantForVm(cloneWizard.sourceVmId);
    if (!tid) return;
    const cloneName = cloneWizard.newName.trim();
    if (!cloneName) { setCloneWizard((p) => ({ ...p, error: t("cloneNameRequired") })); return; }
    setCloneWizard((p) => ({ ...p, submitting: true, error: null }));
    setActionLoading(`${cloneWizard.sourceVmId}-clone`);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${cloneWizard.sourceVmId}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clone", cloneName, sourceVmName: cloneWizard.sourceVmName }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("cloneFailed"));
      setSuccess(t("cloneQueued", { name: cloneName }));
      setCloneWizard({ open: false, sourceVmId: "", sourceVmName: "", newName: "", submitting: false, error: null });
    } catch (err) {
      setCloneWizard((p) => ({ ...p, submitting: false, error: (err as Error).message }));
    } finally { setActionLoading(null); }
  };

  const downloadConsole = async (vmId: string, protocol: "spice" | "vnc" = "spice") => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setConsoleLoading(vmId); setError(null);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}/console?protocol=${protocol}`);
       if (!res.ok) { const d = await parseJsonSafe(res); throw new Error(d?.error ?? t("consoleGetFailed")); }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${vmId}-${protocol}.vv`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setSuccess(t("consoleDownloaded"));
    } catch (err) { setError((err as Error).message); }
    finally { setConsoleLoading(null); }
  };

  const updateResources = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    const draft = resourceDrafts[vmId];
    if (!draft?.memoryMB && !draft?.cpuCores) { setError(t("resourcesRequired")); return; }
    setActionLoading(`${vmId}-update`); setSuccess(null); setError(null);
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${vmId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memoryMB: draft.memoryMB ? Number(draft.memoryMB) : undefined,
          cpuCores: draft.cpuCores ? Number(draft.cpuCores) : undefined,
          sockets: draft.sockets ? Number(draft.sockets) : undefined,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("updateFailed"));
      setSuccess(t("resourcesUpdated"));
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setActionLoading(null); }
  };

  const handleNewVm = async () => {
    if (!selectedTenant || selectedTenant === "undefined" || selectedTenant === ALL_TENANTS) {
      setError(t("selectTenantCreate"));
      return;
    }
    if (!newVm.name || !newVm.clusterId) { setError(t("nameClusterRequired")); return; }
    if (newVmSource === "ova" && !uploadedOva) { setError(t("uploadOvaFirst")); return; }
    if (newVmSource === "ova" && !ovaStorageDomainId) { setError(t("selectOvaStorage")); return; }
    if (newVmSource === "ova" && !ovaHostId) { setError(t("selectOvaHost")); return; }
    setActionLoading("create"); setError(null); setSuccess(null);
    const isOva = newVmSource === "ova";
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    if (isOva) {
      setOvaImportProgress(0);
      progressInterval = setInterval(() => {
        setOvaImportProgress((p) => (p === null ? null : Math.min(p + Math.random() * 3, 95)));
      }, 1500);
    }
    try {
      const res = await fetch(`/api/tenants/${selectedTenant}/${isOva ? "ova/import" : "vms"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isOva ? {
          uploadId: uploadedOva?.uploadId || undefined,
          diskId: uploadedOva?.diskId || undefined,
          ovaName: uploadedOva?.name || undefined,
          name: newVm.name,
          clusterId: newVm.clusterId,
          storageDomainId: ovaStorageDomainId,
          hostId: ovaHostId,
          hostAddress: provHosts.find((h) => h.id === ovaHostId)?.address ?? "",
        } : {
          name: newVm.name, clusterId: newVm.clusterId,
          templateId: newVmSource === "template" ? newVm.templateId || undefined : undefined,
          memoryMB: newVm.memoryMB ? Number(newVm.memoryMB) : undefined,
          cpuCores: newVm.cpuCores ? Number(newVm.cpuCores) : undefined,
          sockets: newVm.sockets ? Number(newVm.sockets) : undefined,
          comment: newVm.comment || undefined,
          os: newVm.os,
          vnicProfileId: newVm.vnicProfileId || undefined,
          cloudInit: useCloudInit && cloudInit.ip ? cloudInit : undefined,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? t("createFailed"));
      setSuccess(isOva
        ? data?.pending
          ? t("ovaImportPending")
          : t("ovaImported")
        : t("vmCreated"));
      setNewVm({ name: "", clusterId: "", templateId: "", memoryMB: "", cpuCores: "", sockets: "1", comment: "", os: "linux", vnicProfileId: "" });
      if (isOva) setUploadedOva(null);
      setCloudInit({ ip: "", netmask: "", gateway: "", dns: "" });
      setUseCloudInit(false);
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally {
      if (progressInterval) clearInterval(progressInterval);
      setOvaImportProgress(null);
      setActionLoading(null);
    }
  };

  /* ── Derived state ── */
  const totals = useMemo(() => {
    const up = vms.filter((vm) => vm.status?.toLowerCase() === "up").length;
    return { up, down: vms.length - up, total: vms.length };
  }, [vms]);

  const inventoryTree = useMemo(() => {
    const isAll = selectedTenant === ALL_TENANTS;
    const clusters = new Map<string, {
      key: string; label: string; tenantId: string; tenantName: string;
      hosts: Map<string, { key: string; label: string; vms: Vm[]; up: number; down: number }>;
      up: number; down: number;
    }>();
    for (const vm of vms) {
      const tId = vm.tenantId ?? (isAll ? "sin-tenant" : selectedTenant);
      const tName = vm.tenantName ?? tenants.find((t) => t.id === tId)?.name ?? tId;
      const clLabel = vm.cluster?.trim() || t("noCluster");
      const clKey = `${tId}::${clLabel.toLowerCase()}`;
      const hLabel = vm.host?.trim() || t("unknownHost");
      const hKey = `${clKey}::${hLabel.toLowerCase()}`;
      const cluster = clusters.get(clKey) ?? { key: clKey, label: clLabel, tenantId: tId, tenantName: tName, hosts: new Map(), up: 0, down: 0 };
      const host = cluster.hosts.get(hKey) ?? { key: hKey, label: hLabel, vms: [], up: 0, down: 0 };
      host.vms.push(vm);
      if ((vm.status?.toLowerCase() ?? "") === "up") { host.up++; cluster.up++; }
      else { host.down++; cluster.down++; }
      cluster.hosts.set(hKey, host);
      clusters.set(clKey, cluster);
    }
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
    return [...clusters.values()].map((c) => ({
      ...c,
      hosts: [...c.hosts.values()]
        .map((h) => ({ ...h, vms: [...h.vms].sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort(byLabel),
    })).sort(byLabel);
  }, [vms, selectedTenant, tenants, locale]);

  // Agrupación por tenant (resource pool) para la vista "Todos"
  const inventoryByTenant = useMemo(() => {
    const map = new Map<string, { id: string; name: string; clusters: typeof inventoryTree; up: number; down: number }>();
    for (const c of inventoryTree) {
      const g = map.get(c.tenantId) ?? { id: c.tenantId, name: c.tenantName, clusters: [], up: 0, down: 0 };
      g.clusters.push(c);
      g.up += c.up;
      g.down += c.down;
      map.set(c.tenantId, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inventoryTree]);

  type ClusterNode = {
    key: string; label: string;
    hosts: { key: string; label: string; vms: Vm[]; up: number; down: number }[];
    up: number; down: number;
  };

  const renderClusterNode = (cluster: ClusterNode) => {
    const cOpen = expandedClusters[cluster.key] ?? true;
    return (
      <div key={cluster.key}>
        <button
          onClick={() => setExpandedClusters((p) => ({ ...p, [cluster.key]: !cOpen }))}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
          style={{ color: "var(--sidebar-text)" }}
          title={cluster.label}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: cOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}>
            <path d="M3 2l4 3-4 3V2z" />
          </svg>
          {!sidebarCollapsed ? (
            <span className="truncate font-medium">{cluster.label}</span>
          ) : (
            <span className="font-bold" style={{ color: "var(--sidebar-muted)" }}>C</span>
          )}
          {!sidebarCollapsed && (
            <span className="ml-auto shrink-0 rounded px-1 text-[10px]"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--sidebar-muted)" }}>
              {cluster.up + cluster.down}
            </span>
          )}
        </button>

        {cOpen && cluster.hosts.map((host) => {
          const hOpen = expandedHosts[host.key] ?? true;
          return (
            <div key={host.key}>
              <button
                onClick={() => setExpandedHosts((p) => ({ ...p, [host.key]: !hOpen }))}
                className="flex w-full items-center gap-2 py-1 text-left text-xs transition-colors"
                style={{ paddingLeft: sidebarCollapsed ? 12 : 24, color: "var(--sidebar-muted)" }}
                title={host.label}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0, transform: hOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}>
                  <path d="M3 2l4 3-4 3V2z" />
                </svg>
                {!sidebarCollapsed && <span className="truncate">{host.label}</span>}
              </button>

              {hOpen && host.vms.map((vm) => (
                <button
                  key={vm.id}
                  onClick={() => setSelectedVmId(vm.id)}
                  title={vm.name}
                  className="flex w-full items-center gap-2 py-1 text-left text-xs transition-colors"
                  style={{
                    paddingLeft: sidebarCollapsed ? 16 : 36,
                    paddingRight: 8,
                    background: selectedVmId === vm.id ? "var(--sidebar-active)" : "transparent",
                    color: selectedVmId === vm.id ? "#93c5fd" : "var(--sidebar-text)",
                  }}
                >
                  <StatusDot status={vm.status} />
                  {!sidebarCollapsed && <span className="truncate">{vm.name}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  const selectedVm = useMemo(() => vms.find((vm) => vm.id === selectedVmId) ?? null, [selectedVmId, vms]);

  useEffect(() => {
    if (canOperate && selectedVm?.status === "up" && selectedVm.id) {
      generateConsolePreview(selectedVm.id);
    } else {
      setConsolePreviewIframe(null);
      setConsolePreviewLoading(false);
    }
  }, [canOperate, selectedVm?.id, selectedVm?.status]);

  // Carga los discos de la VM seleccionada
  useEffect(() => {
    setVmDisks(null);
    if (!selectedVmId) return;
    const tid = tenantForVm(selectedVmId);
    if (!tid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${tid}/vms/${selectedVmId}/disks`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && data?.count !== undefined) setVmDisks(data);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVmId]);

  // Carga resumen de discos por tenant (vista "Todos los tenants")
  useEffect(() => {
    if (selectedTenant !== ALL_TENANTS) return;
    let cancelled = false;
    const uniqueTenants = [...new Set(vms.map((v) => v.tenantId).filter(Boolean))] as string[];
    setTenantDiskMap({});
    uniqueTenants.forEach(async (tid) => {
      try {
        const res = await fetch(`/api/tenants/${tid}/disk-summary`);
        const data = await parseJsonSafe(res);
        if (!cancelled && res.ok && data?.totalSizeGB !== undefined) {
          setTenantDiskMap((prev) => ({ ...prev, [tid]: { totalSizeGB: data.totalSizeGB, usedGB: data.usedGB ?? 0, count: data.count ?? 0 } }));
        }
      } catch { /* noop */ }
    });
    return () => { cancelled = true; };
  }, [selectedTenant, vms]);

  const tenantResourceSummary = useMemo(() => {
    const provisionedCpu = vms.reduce((s, vm) => s + (vm.cpuCores ?? 0), 0);
    const provisionedMem = vms.reduce((s, vm) => s + (vm.memoryMB ?? 0), 0);
    const estCpu = vms.reduce((s, vm) => s + (vm.cpuCores ?? 0) * ((vm.metrics?.cpuPercent ?? 0) / 100), 0);
    const estMem = vms.reduce((s, vm) => s + (vm.memoryMB ?? 0) * ((vm.metrics?.memoryPercent ?? 0) / 100), 0);
    const disk = vms.reduce((s, vm) => s + (vm.metrics?.diskReadBytes ?? 0) + (vm.metrics?.diskWriteBytes ?? 0), 0);
    const net = vms.reduce((s, vm) => s + (vm.metrics?.networkBytes ?? 0), 0);
    return {
      provisionedCpu, provisionedMem, estCpu, estMem,
      cpuPct: provisionedCpu > 0 ? (estCpu / provisionedCpu) * 100 : undefined,
      memPct: provisionedMem > 0 ? (estMem / provisionedMem) * 100 : undefined,
      disk, net,
    };
  }, [vms]);

  const topMemVms = useMemo(() =>
    [...vms].sort((a, b) => (b.memoryMB ?? 0) - (a.memoryMB ?? 0)).slice(0, 5)
    .map((vm) => ({ id: vm.id, name: vm.name, value: vm.memoryMB ?? 0, label: toGB(vm.memoryMB) })),
  [vms, locale]);

  const topCpuVms = useMemo(() =>
    [...vms].sort((a, b) => (b.metrics?.cpuPercent ?? 0) - (a.metrics?.cpuPercent ?? 0)).slice(0, 5)
    .map((vm) => ({ id: vm.id, name: vm.name, value: vm.metrics?.cpuPercent ?? 0, label: `${formatNumber(vm.metrics?.cpuPercent)}%` })),
  [vms, locale]);

  // Resumen de recursos por tenant (vista "Todos los tenants")
  const perTenantSummary = useMemo(() => {
    const map = new Map<string, {
      id: string; name: string; total: number; up: number; down: number;
      provisionedCpu: number; estCpu: number; provisionedMem: number; estMem: number;
    }>();
    for (const vm of vms) {
      const tId = vm.tenantId ?? "sin-tenant";
      const tName = vm.tenantName ?? tenants.find((t) => t.id === tId)?.name ?? tId;
      const g = map.get(tId) ?? { id: tId, name: tName, total: 0, up: 0, down: 0, provisionedCpu: 0, estCpu: 0, provisionedMem: 0, estMem: 0 };
      g.total++;
      if ((vm.status?.toLowerCase() ?? "") === "up") g.up++; else g.down++;
      g.provisionedCpu += vm.cpuCores ?? 0;
      g.estCpu += (vm.cpuCores ?? 0) * ((vm.metrics?.cpuPercent ?? 0) / 100);
      g.provisionedMem += vm.memoryMB ?? 0;
      g.estMem += (vm.memoryMB ?? 0) * ((vm.metrics?.memoryPercent ?? 0) / 100);
      map.set(tId, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [vms, tenants]);

  /* ── Tree expand init ── */
  useEffect(() => {
    if (!inventoryTree.length) { setExpandedClusters({}); setExpandedHosts({}); return; }
    setExpandedClusters((p) => {
      const n: Record<string, boolean> = {};
      for (const c of inventoryTree) n[c.key] = p[c.key] ?? true;
      return n;
    });
  }, [inventoryTree]);

  useEffect(() => {
    if (!inventoryTree.length) { setExpandedHosts({}); return; }
    setExpandedHosts((p) => {
      const n: Record<string, boolean> = {};
      for (const c of inventoryTree) for (const h of c.hosts) n[h.key] = p[h.key] ?? true;
      return n;
    });
  }, [inventoryTree]);

  /* ── Console ── */
  const closeEmbeddedConsole = () => {
    embeddedConsoleSession.current++;
    closingConsole.current = true;
    embeddedConsole.rfb?.disconnect?.();
    setEmbeddedConsole({ vmId: "", status: "idle", error: null, rfb: null, iframeUrl: null });
    if (consoleRef) {
      consoleRef.replaceChildren();
      consoleRef.parentElement?.removeChild(consoleRef);
    }
    setTimeout(() => { closingConsole.current = false; }, 1000);
  };

  const generateConsolePreview = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid) return;
    setConsolePreviewLoading(true);
    setConsolePreviewIframe(null);
    try {
      const infoRes = await fetch(
        `/api/tenants/${tid}/vms/${vmId}/console/info?protocol=vnc&withTicket=1`,
        { cache: "no-store" },
      );
      const info = await parseJsonSafe(infoRes);
      if (!infoRes.ok || info?.error) return;
      const ticket = info.ticket as string | undefined;
      if (!ticket) return;
      const proxyRes = await fetch(
        `/api/console/proxy?tenantId=${tid}&vmId=${vmId}&protocol=vnc&ticket=${encodeURIComponent(ticket)}&consoleId=${encodeURIComponent(info.consoleId ?? "")}`,
        { cache: "no-store" },
      );
      const proxy = await parseJsonSafe(proxyRes);
      if (!proxyRes.ok || !proxy?.proxyWsUrl) return;
      setConsolePreviewIframe(`/console?wsUrl=${encodeURIComponent(proxy.proxyWsUrl)}&ticket=${encodeURIComponent(ticket)}&vmId=${encodeURIComponent(vmId)}&tenantId=${encodeURIComponent(tid)}&preview=1`);
    } catch {
      // silent — preview is optional
    } finally {
      setConsolePreviewLoading(false);
    }
  };

  const openEmbeddedConsole = async (vmId: string) => {
    const tid = tenantForVm(vmId);
    if (!tid || !consoleRef) return;
    if (consoleLoading === vmId || embeddedConsole.status === "connecting") return;
    const sid = ++embeddedConsoleSession.current;
    closingConsole.current = false;
    setEmbeddedConsole({ vmId, status: "connecting", error: null, rfb: null, iframeUrl: null });
    setConsoleLoading(vmId);
    try {
      const infoRes = await fetch(
        `/api/tenants/${tid}/vms/${vmId}/console/info?protocol=vnc&withTicket=1`,
        { cache: "no-store" },
      );
      const info = await parseJsonSafe(infoRes);
      if (!infoRes.ok || info?.error) throw new Error(info?.error ?? t("consoleGetFailed"));
      const ticket = info.ticket as string | undefined;
      if (!ticket) throw new Error(t("consoleTicketMissing"));
      const proxyRes = await fetch(
        `/api/console/proxy?tenantId=${tid}&vmId=${vmId}&protocol=vnc&ticket=${encodeURIComponent(ticket)}&consoleId=${encodeURIComponent(info.consoleId ?? "")}`,
        { cache: "no-store" },
      );
      const proxy = await parseJsonSafe(proxyRes);
      if (!proxyRes.ok || !proxy?.proxyWsUrl) throw new Error(proxy?.error ?? t("websocketUnavailable"));
      const iframeUrl = `/console?wsUrl=${encodeURIComponent(proxy.proxyWsUrl)}&ticket=${encodeURIComponent(ticket)}&vmId=${encodeURIComponent(vmId)}&tenantId=${encodeURIComponent(tid)}&show_fb=0&show_toolbar=1`;
      setEmbeddedConsole({ vmId, status: "connected", error: null, rfb: null, iframeUrl });
    } catch (err) {
      if (embeddedConsoleSession.current !== sid) return;
      setEmbeddedConsole({ vmId, status: "error", error: (err as Error).message, rfb: null, iframeUrl: null });
    } finally { setConsoleLoading(null); }
  };

  const handleSignOut = async () => { setSigningOut(true); await signOut({ callbackUrl: "/login" }); };

  /* ════════════════════════════════════════════════════════════════════
     Render
     ════════════════════════════════════════════════════════════════════ */

  const SIDEBAR_W = sidebarCollapsed ? 56 : 240;
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>

      {/* ── Mobile sidebar overlay ────────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside
        style={{
          width: SIDEBAR_W,
          minWidth: 0,
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--sidebar-border)",
          transition: "width 0.2s ease, transform 0.2s ease",
        }}
        className={`
          fixed left-0 top-0 z-40 h-full flex-col overflow-hidden
          sm:sticky sm:h-screen sm:flex sm:shrink-0
          ${sidebarCollapsed ? "-translate-x-full sm:translate-x-0" : "translate-x-0 flex"}
        `}
      >
        {/* Logo row */}
        <div className="flex items-center justify-between border-b px-3 py-3"
          style={{ borderColor: "var(--sidebar-border)" }}>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1 flex items-center justify-center">
              {(() => {
                const t = tenants.find((t) => t.id === selectedTenant) ?? tenants[0];
                const tenantLogo = t?.brandLogoUrl;
                const globalLogo = portalBranding.hasLogo ? portalBranding.logoUrl : null;
                const logo = tenantLogo || globalLogo;
                const brand = t?.brandName || portalBranding.brandName || "OLVM-PORTAL";
                return (
                  <div className="leading-tight text-center">
                    {logo && // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt={brand} className="mb-1 h-13 w-auto max-w-[180px] object-contain mx-auto" />}
                    <div className="text-[13px] font-bold text-white">{brand}</div>
                    <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--sidebar-muted)" }}>OLVM-PORTAL</div>
                  </div>
                );
              })()}
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed((p) => !p)}
            className="rounded-md p-1.5 transition-colors"
            style={{ color: "var(--sidebar-muted)" }}
            title={sidebarCollapsed ? t("expand") : t("collapse")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              {sidebarCollapsed
                ? <><path d="M3 7h8M7 3l4 4-4 4"/></>
                : <><path d="M11 7H3M7 3L3 7l4 4"/></>}
            </svg>
          </button>
        </div>

        {/* Tenant selector */}
        {!sidebarCollapsed && (
          <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--sidebar-border)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: "var(--sidebar-muted)" }}>{t("activeTenant")}</p>
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-xs font-medium outline-none"
              style={{
                background: "rgba(255,255,255,0.07)", color: "var(--sidebar-text)",
                borderColor: "var(--sidebar-border)",
              }}
            >
              {isSuperadmin && tenants.length > 1 && (
                <option value={ALL_TENANTS} style={{ background: "#1e2535" }}>{t("allTenants")}</option>
              )}
              {tenants.map((t) => (
                <option key={t.id} value={t.id} style={{ background: "#1e2535" }}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Nav tree */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* Vista general */}
          <button
            onClick={() => setSelectedVmId("")}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors"
            style={{
              background: !selectedVm ? "var(--sidebar-active)" : "transparent",
              color: !selectedVm ? "#93c5fd" : "var(--sidebar-text)",
            }}
            title={t("overview")}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
              <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
            </svg>
            {!sidebarCollapsed && <span>{t("overview")}</span>}
          </button>

          {/* Separator + label */}
          {!sidebarCollapsed && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--sidebar-muted)" }}>
                {t("inventoryCount", { count: vms.length })}
              </p>
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={refresh}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors"
            style={{ color: "var(--sidebar-muted)" }}
            title={t("refreshInventory")}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/>
              <path d="M12 4l0.5-2.5 2 1.5M4 12l-0.5 2.5-2-1.5"/>
            </svg>
            {!sidebarCollapsed && <span>{loading ? t("loading") : t("refresh")}</span>}
          </button>

          {/* Tree */}
          {inventoryExpanded && (
            selectedTenant === ALL_TENANTS ? (
              inventoryByTenant.map((t) => {
                const tOpen = expandedTenants[t.id] ?? true;
                return (
                  <div key={t.id}>
                    <button
                      onClick={() => setExpandedTenants((p) => ({ ...p, [t.id]: !tOpen }))}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors"
                      style={{ color: "var(--sidebar-text)" }}
                      title={t.name}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.7, flexShrink: 0, transform: tOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}>
                        <path d="M3 2l4 3-4 3V2z" />
                      </svg>
                      {!sidebarCollapsed ? (
                        <span className="truncate">{t.name}</span>
                      ) : (
                        <span style={{ color: "var(--sidebar-muted)" }}>▣</span>
                      )}
                      {!sidebarCollapsed && (
                        <span className="ml-auto shrink-0 rounded px-1 text-[10px]"
                          style={{ background: "rgba(37,99,235,0.3)", color: "var(--sidebar-text)" }}>
                          {t.up + t.down}
                        </span>
                      )}
                    </button>
                    {tOpen && t.clusters.map(renderClusterNode)}
                  </div>
                );
              })
            ) : (
              inventoryTree.map(renderClusterNode)
            )
          )}

          {vms.length === 0 && !loading && !sidebarCollapsed && (
            <p className="px-4 py-3 text-[11px]" style={{ color: "var(--sidebar-muted)" }}>
              {t("noVisibleVms")}
            </p>
          )}
        </div>

        {/* Bottom stats */}
        {!sidebarCollapsed && (
          <div className="border-t px-3 py-2" style={{ borderColor: "var(--sidebar-border)" }}>
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--sidebar-muted)" }}>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{totals.up} up</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{totals.down} down</span>
              <span>{totals.total} {t("total")}</span>
            </div>
            <div className="mt-2 flex justify-center border-t pt-2" style={{ borderColor: "var(--sidebar-border)" }}>
              <a
                href="https://sixmanager.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-medium uppercase tracking-widest transition-opacity hover:opacity-80"
                style={{ color: "var(--sidebar-muted)" }}
              >
                {t("poweredBy")} <span className="font-semibold text-gray-300">Sixmanager</span>
              </a>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-white px-3"
          style={{ borderColor: "var(--border)" }}>
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarCollapsed((p) => !p)}
            className="flex sm:hidden items-center justify-center rounded p-1.5 text-gray-500 hover:bg-gray-100"
            title={t("menu")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 4h12M2 8h12M2 12h12"/>
            </svg>
          </button>

          {/* Breadcrumb — truncates gracefully */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-gray-500 overflow-hidden">
            <button
              onClick={() => { setSelectedVmId(""); setSelectedTenant(isSuperadmin ? ALL_TENANTS : tenants[0]?.id ?? ""); }}
              className="flex shrink-0 items-center gap-1 font-semibold text-gray-800 hover:text-blue-600"
              title={t("home")}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z"/>
                <path d="M6 14.5V9h4v5.5"/>
              </svg>
              OLVM-PORTAL
            </button>
            {tenantName && <><span className="shrink-0">/</span><span className="truncate">{tenantName}</span></>}
            {selectedVm && <><span className="shrink-0">/</span><span className="truncate text-gray-700">{selectedVm.name}</span></>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden md:flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="max-w-[140px] truncate">{session?.user?.email ?? t("unknownUser")}</span>
            </span>
            <LanguageSelector />
            {/* Mobile: right panel toggle */}
            <button
              onClick={() => setRightPanelOpen((p) => !p)}
              className="flex lg:hidden items-center justify-center rounded border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
              title={t("actionsPanel")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="1" y="1" width="12" height="12" rx="2"/>
                <path d="M9 1v12"/>
              </svg>
            </button>
            {canAdmin && (
              <Link
                href="/admin/users"
                className="hidden sm:inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                title={t("userAdmin")}
              >
                {t("users")}
              </Link>
            )}
            {session?.user?.role === "superadmin" && (
              <Link
                href="/admin/clusters"
                className="hidden sm:inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                title={t("olvmConnectionsAdmin")}
              >
                {t("settings")}
              </Link>
            )}
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              {signingOut ? "..." : t("signOut")}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Center panel ───────────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto p-4">

            {/* Toasts */}
            {uploadProgress !== null && (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <div className="mb-1 flex items-center justify-between">
                  <span>{uploadProgress < 100 ? t("uploadingFile", { name: uploadFileName, progress: uploadProgress }) : t("processingFile", { name: uploadFileName })}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                  <div className={`h-full rounded-full ${uploadProgress < 100 ? "bg-blue-500" : "bg-blue-400 animate-pulse"} transition-all duration-300`} style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
            {cloneJobs.map((job) => (
              <div key={job.id} className={`mb-3 rounded-md border px-3 py-2 text-xs ${job.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : job.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                     <span>{t("operationProgress", { action: t(`operationAction${job.action[0].toUpperCase()}${job.action.slice(1)}`), name: job.targetVmName || job.targetVmId || "", stage: t(`operationStage${job.stage[0].toUpperCase()}${job.stage.slice(1)}`) })}</span>
                    <span className="shrink-0 rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-600">
                        {t(job.origin === "api" ? "operationOriginApi" : "operationOriginPortal", { email: job.requesterLabel || job.requestedBy.split("@", 1)[0] })}
                    </span>
                  </span>
                  <span className="tabular-nums">{job.progress}%</span>
                </div>
                <div className={`h-1.5 w-full overflow-hidden rounded-full ${job.status === "completed" ? "bg-emerald-100" : job.status === "failed" ? "bg-red-100" : "bg-blue-100"}`}>
                  <div className={`h-full rounded-full transition-all duration-300 ${job.status === "completed" ? "bg-emerald-500" : job.status === "failed" ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${clampPercent(job.progress)}%` }} />
                </div>
              </div>
            ))}
            {error && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600" title={t("close")}>✕</button>
              </div>
            )}
            {success && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <span>{success}</span>
                <button onClick={() => setSuccess(null)} className="ml-3 text-emerald-400 hover:text-emerald-600" title={t("close")}>✕</button>
              </div>
            )}

            {/* Page title row */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-bold text-gray-900">
                  {selectedVm ? selectedVm.name : t("tenantDashboard")}
                </h1>
                <p className="truncate text-[11px] text-gray-500">
                  {selectedVm
                    ? `${selectedVm.tenantName ?? tenantName} / ${selectedVm.cluster || t("noCluster")} / ${selectedVm.host || t("unknownHost")}`
                    : t("consolidatedSummary", { tenant: tenantName || t("activeTenantFallback") })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedVm && (
                  <>
                    <StatusBadge status={selectedVm.status} />
                    <button
                      onClick={() => setSelectedVmId("")}
                      className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                    >
                      {t("back")}
                    </button>
                  </>
                )}
                <button
                  onClick={refresh}
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  {loading ? "..." : "↻"}
                </button>
              </div>
            </div>

            {/* ── DASHBOARD VIEW ── */}
            {!selectedVm && (
              <>
                {/* KPI row */}
                <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
                  <StatCard label={t("totalVms")} value={totals.total} />
                  <StatCard label={t("poweredOn")} value={totals.up} sub={t("stateUp")} accent />
                  <StatCard label={t("poweredOff")} value={totals.down} sub={t("stateDown")} warning />
                  <StatCard label={t("provisionedCpu")} value={`${totals.total > 0 ? formatNumber(tenantResourceSummary.provisionedCpu, {maximumFractionDigits:0}) : "—"} vCPU`} />
                </div>

                {/* Donut metrics row */}
                <div className="mb-4 grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-3">
                {/* CPU */}
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("totalCpu")}</p>
                    <div className="flex items-center gap-3">
                      <DonutRing value={tenantResourceSummary.cpuPct} color="#3b82f6" />
                      <div>
                        <p className="text-lg font-bold text-gray-900">
                          {formatNumber(tenantResourceSummary.provisionedCpu, { maximumFractionDigits: 0 })} vCPU
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {t("estimatedUsage", { value: `${formatNumber(tenantResourceSummary.estCpu)} vCPU` })}
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* RAM */}
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("totalRam")}</p>
                    <div className="flex items-center gap-3">
                      <DonutRing value={tenantResourceSummary.memPct} color="#10b981" />
                      <div>
                        <p className="text-lg font-bold text-gray-900">{toGB(tenantResourceSummary.provisionedMem)}</p>
                        <p className="text-[11px] text-gray-400">{t("estimatedUsage", { value: toGB(tenantResourceSummary.estMem) })}</p>
                      </div>
                    </div>
                  </div>
                  {/* Traffic */}
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("activeTraffic")}</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">{t("diskRw")}</span>
                        <span className="text-sm font-semibold text-gray-900">{formatBytes(tenantResourceSummary.disk)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">{t("network")}</span>
                        <span className="text-sm font-semibold text-gray-900">{formatBytes(tenantResourceSummary.net)}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                        <div className="h-full w-full rounded-full" style={{ background: "linear-gradient(90deg,#10b981,#3b82f6,#f59e0b)", opacity: totals.total === 0 ? 0.3 : 1 }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Storage Domains */}
                {selectedTenant !== ALL_TENANTS && storageDomains.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Storage Domains</p>
                      {isSuperadmin && (
                        <button
                          onClick={() => setShowAllSds((v) => !v)}
                          className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50"
                        >
                          {showAllSds ? t("assignedOnly") : t("viewAll")}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {storageDomains.map((sd) => {
                        const usedPct = sd.totalGB > 0 ? (sd.usedGB / sd.totalGB) * 100 : 0;
                        return (
                          <div key={sd.id} className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-bold text-gray-900">{sd.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sd.status === "active" || !sd.status ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                {sd.type.toUpperCase()}
                              </span>
                            </div>
                            <div className="mb-1.5 flex items-baseline gap-2">
                              <span className="text-lg font-bold text-gray-900">{formatNumber(sd.availableGB, { maximumFractionDigits: 0 })} GB</span>
                              <span className="text-[11px] text-gray-400">{t("freeOf", { total: formatNumber(sd.totalGB, { maximumFractionDigits: 0 }) })}</span>
                            </div>
                            <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <div className={`h-full rounded-full ${usedPct > 80 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, usedPct)}%` }} />
                            </div>
                            <p className="text-[10px] text-gray-400">{t("inUse", { used: formatNumber(sd.usedGB, { maximumFractionDigits: 0 }), percent: formatNumber(usedPct, { maximumFractionDigits: 0 }) })}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Per-tenant summary (only in "Todos los tenants" mode) */}
                {selectedTenant === ALL_TENANTS && perTenantSummary.length > 1 && (
                  <div className="mb-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("tenantSummary")}</p>
                    <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {perTenantSummary.map((tenantSummary) => {
                        const cpuPct = tenantSummary.provisionedCpu > 0 ? (tenantSummary.estCpu / tenantSummary.provisionedCpu) * 100 : 0;
                        const memPct = tenantSummary.provisionedMem > 0 ? (tenantSummary.estMem / tenantSummary.provisionedMem) * 100 : 0;
                        return (
                          <button
                            key={tenantSummary.id}
                            onClick={() => setSelectedTenant(tenantSummary.id)}
                            className="rounded-lg border bg-white p-3 text-left transition hover:border-blue-300 hover:shadow-sm"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="truncate text-sm font-bold text-gray-900">{tenantSummary.name}</span>
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ background: tenantSummary.down > 0 ? "#fef3c7" : "#d1fae5", color: tenantSummary.down > 0 ? "#92400e" : "#065f46" }}>
                                {tenantSummary.up}/{tenantSummary.total} UP
                              </span>
                            </div>
                            <div className="space-y-1.5 text-[11px]">
                              <div>
                                <div className="mb-0.5 flex justify-between">
                                  <span className="text-gray-400">CPU</span>
                                  <span className="text-gray-700">{formatNumber(tenantSummary.provisionedCpu, { maximumFractionDigits: 0 })} vCPU · {formatNumber(cpuPct)}%</span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, cpuPct)}%` }} />
                                </div>
                              </div>
                              <div>
                                <div className="mb-0.5 flex justify-between">
                                  <span className="text-gray-400">RAM</span>
                                  <span className="text-gray-700">{toGB(tenantSummary.provisionedMem)} · {formatNumber(memPct)}%</span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, memPct)}%` }} />
                                </div>
                              </div>
                              <div>
                                {(() => {
                                  const td = tenantDiskMap[tenantSummary.id];
                                  if (!td) return (
                                    <div className="mb-0.5 flex justify-between">
                                      <span className="text-gray-400">{t("disk")}</span>
                                      <span className="text-gray-300">{t("loadingEllipsis")}</span>
                                    </div>
                                  );
                                  const diskPct = td.totalSizeGB > 0 ? (td.usedGB / td.totalSizeGB) * 100 : 0;
                                  return (
                                    <>
                                      <div className="mb-0.5 flex justify-between">
                                        <span className="text-gray-400">{t("disk")}</span>
                                        <span className="text-gray-700">{formatNumber(td.totalSizeGB, { maximumFractionDigits: 0 })} GB · {formatNumber(diskPct)}%</span>
                                      </div>
                                      <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, diskPct)}%` }} />
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top VMs */}
                <div className="mb-4 grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2">
                  {/* RAM por VM */}
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("topRam")}</p>
                    {topMemVms.length === 0
                      ? <p className="text-[11px] text-gray-400">{t("noData")}</p>
                      : topMemVms.map((vm) => {
                        const pct = tenantResourceSummary.provisionedMem > 0 ? (vm.value / tenantResourceSummary.provisionedMem) * 100 : 0;
                        return (
                          <div key={vm.id} className="mb-1.5">
                            <div className="mb-0.5 flex items-center justify-between">
                              <span className="truncate text-[11px] text-gray-700">{vm.name}</span>
                              <span className="ml-2 shrink-0 text-[11px] text-gray-400">{vm.label}</span>
                            </div>
                            <MiniBar value={pct} color="bg-emerald-500" />
                          </div>
                        );
                      })}
                  </div>
                  {/* CPU por VM */}
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("topCpu")}</p>
                    {topCpuVms.length === 0
                      ? <p className="text-[11px] text-gray-400">{t("noData")}</p>
                      : topCpuVms.map((vm) => (
                        <div key={vm.id} className="mb-1.5">
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="truncate text-[11px] text-gray-700">{vm.name}</span>
                            <span className="ml-2 shrink-0 text-[11px] text-gray-400">{vm.label}</span>
                          </div>
                          <MiniBar value={vm.value} color="bg-blue-500" />
                        </div>
                      ))}
                  </div>
                </div>

                {/* VM table */}
                <div className="rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {t("virtualMachines", { count: vms.length })}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px] text-xs">
                      <thead>
                        <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("status")}</th>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("name")}</th>
                          <th className="hidden md:table-cell px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cluster</th>
                          <th className="hidden lg:table-cell px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Host</th>
                          <th className="hidden sm:table-cell px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 w-28">CPU</th>
                          <th className="hidden sm:table-cell px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 w-28">RAM</th>
                          <th className="hidden md:table-cell px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">vCPU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vms.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                            {loading ? t("loadingVms") : t("noTenantVms")}
                          </td></tr>
                        )}
                        {vms.map((vm) => (
                          <tr
                            key={vm.id}
                            onClick={() => setSelectedVmId(vm.id)}
                            className="cursor-pointer border-b transition-colors hover:bg-gray-50"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <td className="px-3 py-2"><StatusBadge status={vm.status} /></td>
                            <td className="px-3 py-2 font-medium text-gray-900 max-w-[120px] truncate">{vm.name}</td>
                            <td className="hidden md:table-cell px-3 py-2 text-gray-500 max-w-[100px] truncate">{vm.cluster || "—"}</td>
                            <td className="hidden lg:table-cell px-3 py-2 text-gray-500 max-w-[100px] truncate">{vm.host || "—"}</td>
                            <td className="hidden sm:table-cell px-3 py-2 w-28">
                              <MiniBar value={vm.metrics?.cpuPercent} color="bg-blue-400" />
                            </td>
                            <td className="hidden sm:table-cell px-3 py-2 w-28">
                              <MiniBar value={vm.metrics?.memoryPercent} color="bg-emerald-400" />
                            </td>
                            <td className="hidden md:table-cell px-3 py-2 text-gray-500">{vm.cpuCores ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Action history */}
                {actionHistory.length > 0 && (
                  <div className="mt-3 rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("recentActions")}</p>
                    <div className="space-y-1">
                      {actionHistory.map((entry) => (
                        <div key={`${entry.vmId}-${entry.timestamp}`}
                          className="flex items-center justify-between gap-3 text-[11px]">
                          <span className="text-gray-600">{actionLabel(entry.action)} · <span className="text-gray-400">{entry.vmId}</span></span>
                          <span className="text-gray-400">{new Date(entry.timestamp).toLocaleTimeString(locale)}</span>
                          <span className={entry.status === "ok" ? "text-emerald-600" : entry.status === "pending" ? "text-amber-500" : "text-red-500"}>
                            {entry.status === "pending" ? t("actionPending") : entry.status === "ok" ? t("actionOk") : t("actionError")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── VM DETAIL VIEW ── */}
            {selectedVm && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Identity */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("identity")}</p>
                  <dl className="space-y-1 text-xs">
                    {[
                      [t("operatingSystem"), selectedVm.os ?? t("notAvailable")],
                      ["Template", selectedVm.template ?? t("notAvailable")],
                      ["Cluster", selectedVm.cluster ?? t("notAvailable")],
                      ["Host", selectedVm.host ?? t("notAvailable")],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-32 shrink-0 text-gray-400">{k}</dt>
                        <dd className="min-w-0 break-all text-gray-800">{v}</dd>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-400">Tags</dt>
                      <dd className="min-w-0">
                        {selectedVm.tags && selectedVm.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {selectedVm.tags.map((tag) => (
                              <span key={tag} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{tag}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-300">{t("noTags")}</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-400">ID</dt>
                      <dd className="min-w-0 break-all text-gray-500">{selectedVm.id}</dd>
                    </div>
                  </dl>
                </div>
                {/* Consola */}
                {canOperate && selectedVm.status === "up" && (
                  <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("console")}</p>
                    <div className="relative mb-2 overflow-hidden rounded-md border bg-black" style={{ aspectRatio: "16/9", borderColor: "var(--border)" }}>
                      {consolePreviewLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                        </div>
                      ) : consolePreviewIframe ? (
                        <iframe src={consolePreviewIframe} className="h-full w-full border-0" title={t("consolePreview")} style={{ pointerEvents: "none" }} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-white/40">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setConsolePreviewIframe(null); openEmbeddedConsole(selectedVm.id); }}
                      disabled={consoleLoading === selectedVm.id || embeddedConsole.status === "connecting"}
                      className="w-full rounded-md bg-blue-600 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                    >
                      {consoleLoading === selectedVm.id || embeddedConsole.status === "connecting" ? t("connecting") : t("openConsole")}
                    </button>
                  </div>
                )}
                {/* Red */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("network")}</p>
                  <div className="space-y-1.5">
                    {vmNics.length > 0 ? (
                      vmNics.map((n) => {
                        const isUp = n.linked && n.plugged;
                        return (
                        <div key={n.id} className="flex flex-col gap-0.5">
                          <div className="flex justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-500">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${isUp ? "bg-emerald-500" : "bg-gray-300"}`} title={isUp ? t("nicUp") : t("nicDown")} />
                              {n.networkName || n.name}
                            </span>
                            <span className="font-semibold text-gray-800">{n.ipv4 ?? t("noIp")}</span>
                          </div>
                          <div className="flex justify-between text-[9px] text-gray-400">
                            <span>{n.interface} · <span className={isUp ? "font-medium text-emerald-600" : ""}>{isUp ? t("nicUp") : t("nicDown")}</span></span>
                            <span>MAC: {n.mac ?? "—"}</span>
                          </div>
                        </div>
                        );
                      })
                    ) : (
                      <p className="text-[11px] text-gray-400">{t("noActiveNics")}</p>
                    )}
                  </div>
                </div>
                {/* CPU */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">CPU</p>
                  <div className="flex items-center gap-3">
                    <DonutRing value={selectedVm.metrics?.cpuPercent} color="#3b82f6" />
                    <div>
                      <p className="text-lg font-bold text-gray-900">{formatNumber(selectedVm.metrics?.cpuPercent)}%</p>
                      <p className="text-[11px] text-gray-400">{selectedVm.cpuCores ?? "—"} vCPU · {t("socketsCount", { count: selectedVm.sockets ?? "—" })}</p>
                    </div>
                  </div>
                </div>
                {/* RAM */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("memory")}</p>
                  <div className="flex items-center gap-3">
                    <DonutRing value={selectedVm.metrics?.memoryPercent} color="#10b981" />
                    <div>
                      <p className="text-lg font-bold text-gray-900">{toGB(selectedVm.memoryMB)}</p>
                      <p className="text-[11px] text-gray-400">
                         {t("estimatedUsage", { value: toGB(selectedVm.memoryMB && selectedVm.metrics?.memoryPercent
                           ? selectedVm.memoryMB * (selectedVm.metrics.memoryPercent / 100) : undefined) })}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Disk/Net */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">I/O</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                       <span className="text-gray-500">{t("diskRead")}</span>
                      <span className="font-semibold">{formatBytes(selectedVm.metrics?.diskReadBytes)}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-gray-500">{t("diskWrite")}</span>
                      <span className="font-semibold">{formatBytes(selectedVm.metrics?.diskWriteBytes)}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-gray-500">{t("network")}</span>
                      <span className="font-semibold">{formatBytes(selectedVm.metrics?.networkBytes)}</span>
                    </div>
                  </div>
                </div>
                {/* Storage */}
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
                   <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("disk")}</p>
                  {vmDisks ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-3">
                        <DonutRing value={vmDisks.totalSizeGB > 0 ? (vmDisks.usedGB / vmDisks.totalSizeGB) * 100 : undefined} color="#f59e0b" />
                        <div>
                           <p className="text-lg font-bold text-gray-900">{formatNumber(vmDisks.totalSizeGB)} GB</p>
                           <p className="text-[11px] text-gray-400">{t("diskCountUsed", { count: vmDisks.count, used: formatNumber(vmDisks.usedGB) })}</p>
                        </div>
                      </div>
                      {vmDisks.disks.length > 0 && (
                        <div className="space-y-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                          {vmDisks.disks.map((d, i) => (
                            <div key={i} className="flex justify-between">
                               <span className="truncate text-gray-500" title={d.name}>{d.name ?? t("diskNumber", { number: i + 1 })}</span>
                               <span className="shrink-0 font-semibold">{formatNumber(d.sizeGB)} GB{d.usedGB != null ? ` (${formatNumber(d.usedGB)})` : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                     <p className="text-xs text-gray-400">{t("loadingEllipsis")}</p>
                  )}
                </div>
              </div>
            )}
          </main>

          {/* ── Right panel (detail/actions) ─────────────────────────── */}
          {/* Mobile overlay backdrop */}
          {rightPanelOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/30 lg:hidden"
              onClick={() => setRightPanelOpen(false)}
            />
          )}
          <aside
            className={`
              fixed right-0 top-0 z-40 h-full w-72 overflow-y-auto border-l bg-white shadow-xl transition-transform duration-200
              lg:static lg:z-auto lg:w-64 lg:shadow-none lg:translate-x-0
              ${rightPanelOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}
            `}
            style={{ borderColor: "var(--border)" }}
          >
            <div className="p-3">
              {/* Tabs */}
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-0.5">
                {(["overview","actions","resources","provisioning","console"] as const)
                  .filter((tab) => tab === "overview"
                    || ((tab === "actions" || tab === "console") && canOperate)
                    || ((tab === "resources" || tab === "provisioning") && canRead))
                  .map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className="rounded px-2 py-1 text-[11px] font-semibold transition-colors"
                    style={{
                      background: detailTab === tab ? "white" : "transparent",
                      color: detailTab === tab ? "#1d4ed8" : "#6b7280",
                      boxShadow: detailTab === tab ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                     {{overview:t("detail"),actions:t("actions"),resources:t("resources"),provisioning:canAdmin ? t("new") : t("catalog"),console:t("console")}[tab]}
                  </button>
                ))}
              </div>

              {/* ── Overview tab ── */}
              {detailTab === "overview" && (
                selectedVm ? (
                  <div className="space-y-2">
                    <div className="rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
                       <p className="text-[10px] text-gray-400 mb-1">{t("status")}</p>
                      <StatusBadge status={selectedVm.status} />
                    </div>
                    <div className="rounded-md border p-2.5 space-y-1.5" style={{ borderColor: "var(--border)" }}>
                      {[
                        ["Cluster", selectedVm.cluster ?? t("notAvailable")],
                        ["Host", selectedVm.host ?? t("notAvailable")],
                        ["RAM", toGB(selectedVm.memoryMB)],
                        ["vCPU", t("coresCount", { count: selectedVm.cpuCores ?? "—" })],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between text-[11px]">
                          <span className="text-gray-400">{k}</span>
                          <span className="font-medium text-gray-800">{v}</span>
                        </div>
                      ))}
                    </div>
                    {/* Disk usage */}
                    <div className="rounded-md border p-2.5 space-y-2" style={{ borderColor: "var(--border)" }}>
                       <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("storage")}</p>
                      {vmDisks ? (
                        vmDisks.count === 0 ? (
                           <p className="text-[11px] text-gray-400">{t("noDisks")}</p>
                        ) : (
                          <>
                            {/* Usage bar */}
                            <div>
                              <div className="mb-1 flex justify-between text-[11px]">
                                <span className="text-gray-400">{formatNumber(vmDisks.usedGB)} / {formatNumber(vmDisks.totalSizeGB)} GB</span>
                                <span className="font-semibold text-gray-700">{vmDisks.totalSizeGB > 0 ? Math.round((vmDisks.usedGB / vmDisks.totalSizeGB) * 100) : 0}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className="h-full rounded-full bg-amber-500"
                                  style={{ width: `${vmDisks.totalSizeGB > 0 ? Math.min(100, (vmDisks.usedGB / vmDisks.totalSizeGB) * 100) : 0}%` }}
                                />
                              </div>
                            </div>
                            {/* Per-disk breakdown */}
                            {vmDisks.disks.map((d, i) => (
                              <div key={i} className="space-y-0.5">
                                <div className="flex justify-between text-[11px]">
                                   <span className="truncate text-gray-500" title={d.name}>{d.name ?? t("diskNumber", { number: i + 1 })}</span>
                                  <span className="shrink-0 font-medium text-gray-700">{formatNumber(d.sizeGB, { maximumFractionDigits: 0 })} GB</span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{ width: `${d.sizeGB > 0 ? Math.min(100, ((d.usedGB ?? 0) / d.sizeGB) * 100) : 0}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </>
                        )
                      ) : (
                         <p className="text-[11px] text-gray-400">{t("loadingEllipsis")}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
                       <p className="text-[11px] text-gray-500">{t("selectVmDetail")}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-md border p-2 text-center" style={{ borderColor: "var(--border)" }}>
                        <p className="text-base font-bold text-gray-900">{totals.total}</p>
                        <p className="text-[10px] text-gray-400">{t("total")}</p>
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-center">
                        <p className="text-base font-bold text-emerald-700">{totals.up}</p>
                        <p className="text-[10px] text-emerald-600">Up</p>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-center">
                        <p className="text-base font-bold text-amber-700">{totals.down}</p>
                        <p className="text-[10px] text-amber-600">Down</p>
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* ── Actions tab ── */}
              {detailTab === "actions" && (
                selectedVm ? (
                  <div className="space-y-1.5">
                    {powerTransition?.vmId === selectedVm.id && (() => {
                      const status = selectedVm.status?.toLowerCase() ?? "";
                      const isStop = powerTransition.action === "stop";
                       const phases = isStop ? [t("sending"), t("poweringOff"), t("ready")] : [t("sending"), t("poweringOn"), t("ready")];
                      const step = status === "wait_for_launch" ? 0
                        : status === "powering_up" || status === "powering_down" || status === "reboot_in_progress" ? 1
                        : (isStop ? status === "down" : status === "up") ? 2 : 0;
                      return (
                        <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 space-y-2">
                          <div className="flex items-center justify-between">
                            {phases.map((phase, i) => (
                              <div key={i} className="flex items-center gap-1">
                                <div className={`h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold transition-all ${
                                  i < step ? "bg-emerald-500 text-white" :
                                  i === step ? "bg-blue-500 text-white animate-pulse" :
                                  "bg-gray-200 text-gray-400"
                                }`}>{i < step ? "✓" : i + 1}</div>
                                <span className={`text-[10px] font-medium ${i <= step ? "text-blue-700" : "text-gray-400"}`}>{phase}</span>
                              </div>
                            ))}
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                            <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-1000"
                              style={{ width: `${((step + 1) / 3) * 100}%` }} />
                          </div>
                           <p className="text-[10px] text-blue-600">{t("currentStatus", { status: selectedVm.status })}</p>
                        </div>
                      );
                    })()}
                    {[
                       { label: t("start"), action: "start" },
                       { label: t("stop"), action: "stop" },
                       { label: t("shutdown"), action: "shutdown" },
                       { label: t("reboot"), action: "reboot" },
                    ].map(({ label, action }) => (
                      <ActionButton
                        key={action} label={label}
                        onClick={() => runAction(selectedVm.id, action)}
                        loading={actionLoading === `${selectedVm.id}-${action}`}
                      />
                    ))}
                    <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                    {canAdmin && (
                      <ActionButton
                         label={t("cloneVm")}
                        onClick={() => openCloneWizard(selectedVm)}
                        loading={actionLoading === `${selectedVm.id}-clone`}
                      />
                    )}
                    <ActionButton
                       label={t("vncConsole")}
                      onClick={() => downloadConsole(selectedVm.id, "vnc")}
                      loading={consoleLoading === selectedVm.id}
                    />
                    {showExperimentalConsole && (
                      <ActionButton
                         label={t("embeddedConsole")}
                        onClick={() => openEmbeddedConsole(selectedVm.id)}
                        loading={consoleLoading === selectedVm.id}
                        disabled={(selectedVm.status?.toLowerCase?.() ?? "") !== "up"}
                      />
                    )}
                    {isSuperadmin && selectedTenant !== ALL_TENANTS && (
                      <>
                        <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                        <ActionButton
                           label={t("assignTenantTag")}
                          onClick={() => toggleTag(selectedVm.id, true)}
                          loading={actionLoading === `${selectedVm.id}-tag`}
                        />
                        <ActionButton
                           label={t("removeTenantTag")}
                          onClick={() => toggleTag(selectedVm.id, false)}
                          loading={actionLoading === `${selectedVm.id}-tag`}
                        />
                      </>
                    )}
                    {selectedTenant !== ALL_TENANTS && (
                      <>
                        <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                        <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ISO / CD-ROM</p>
                        {mountedIso && (
                          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
                            <span className="truncate text-[11px] text-amber-800">
                               {isoList.find((i) => i.id === mountedIso)?.name ?? t("mountedIso")}
                            </span>
                            <button
                              onClick={() => {
                                 if (window.confirm(t("ejectIsoConfirm"))) {
                                  handleMountIso(selectedVm.id, null);
                                }
                              }}
                              disabled={actionLoading === `${selectedVm.id}-iso`}
                              className="ml-2 shrink-0 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            >
                               {t("eject")}
                            </button>
                          </div>
                        )}
                        <select
                          value=""
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/tenants/${selectedTenant}/isos`);
                              const data = await parseJsonSafe(res);
                              if (res.ok && Array.isArray(data)) setIsoList(data);
                            } catch { /* noop */ }
                          }}
                          onChange={(e) => e.target.value && handleMountIso(selectedVm.id, e.target.value)}
                          disabled={actionLoading === `${selectedVm.id}-iso`}
                          className={`w-full rounded-md border px-2 py-1.5 text-[11px] ${actionLoading === `${selectedVm.id}-iso}` ? "opacity-50" : ""}`}
                          style={{ borderColor: "var(--border)" }}
                        >
                           <option value="">{actionLoading === `${selectedVm.id}-iso` ? t("mounting") : t("mountIso")}</option>
                          {isoList.filter((i) => i.id !== mountedIso).map((iso) => (
                            <option key={iso.id} value={iso.id}>
                              {iso.name}{iso.storageDomainName ? ` (${iso.storageDomainName})` : ""}
                            </option>
                          ))}
                        </select>
                        {isSuperadmin && (
                          <label className={`flex w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-gray-300 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 ${uploadingIso ? "opacity-50 pointer-events-none" : ""}`} style={{ borderColor: "var(--border)" }}>
                             {uploadingIso ? t("uploadingIso") : t("uploadIso")}
                            <input
                              type="file"
                              accept=".iso"
                              className="hidden"
                              disabled={uploadingIso}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleUploadIso(f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </>
                    )}
                    {selectedTenant !== ALL_TENANTS && (
                      <>
                        <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                         <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("disks")}</p>
                        {vmDiskList.length > 0 && (
                          <div className="space-y-1">
                            {vmDiskList.map((d) => (
                              <div key={d.attachmentId} className="flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ borderColor: "var(--border)" }}>
                                <span className="flex-1 truncate text-[10px] text-gray-600">{d.name}</span>
                                <span className="shrink-0 text-[10px] text-gray-400">{formatNumber(d.sizeGB, { maximumFractionDigits: 0 })}GB</span>
                                <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-500">{d.interface || "?"}</span>
                                {d.bootable && <span className="shrink-0 rounded bg-blue-50 px-1 py-0.5 text-[9px] text-blue-600">boot</span>}
                                <button
                                  onClick={() => {
                                     if (window.confirm(t("deleteDiskConfirm", { name: d.name, size: formatNumber(d.sizeGB, { maximumFractionDigits: 0 }) }))) {
                                      handleDeleteDisk(selectedVm.id, d.attachmentId, d.diskId);
                                    }
                                  }}
                                  disabled={actionLoading === `${selectedVm.id}-del-disk`}
                                  className="shrink-0 rounded border border-red-200 px-1 py-0.5 text-[9px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                   {t("deleteShort")}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            type="number" min={1}
                            value={newDiskSize}
                            onChange={(e) => setNewDiskSize(e.target.value)}
                            className="rounded-md border px-2 py-1.5 text-[11px]"
                            style={{ borderColor: "var(--border)" }}
                            placeholder="GB"
                          />
                          <select
                            value={newDiskSd}
                            onChange={(e) => setNewDiskSd(e.target.value)}
                            className="rounded-md border px-2 py-1.5 text-[11px]"
                            style={{ borderColor: "var(--border)" }}
                          >
                             <option value="">{t("automaticSd")}</option>
                            {storageDomains.map((sd) => (
                              <option key={sd.id} value={sd.id}>{sd.name}</option>
                            ))}
                          </select>
                        </div>
                        <select
                          value={newDiskIface}
                          onChange={(e) => setNewDiskIface(e.target.value)}
                          className="w-full rounded-md border px-2 py-1.5 text-[11px]"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <option value="virtio_scsi">VirtIO SCSI (Linux)</option>
                          <option value="sata">SATA (Windows)</option>
                           <option value="ide">IDE ({t("compatibility")})</option>
                        </select>
                        <ActionButton
                           label={t("addDisk")}
                          onClick={() => handleAddDisk(selectedVm.id)}
                          loading={actionLoading === `${selectedVm.id}-disk`}
                        />
                        <ActionButton
                           label={t("startFromCd")}
                          onClick={() => handleRunOnceCd(selectedVm.id)}
                          loading={actionLoading === `${selectedVm.id}-run_once`}
                        />
                      </>
                    )}
                    <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                    <ActionButton
                       label={t("deleteVm")}
                      onClick={() => {
                         if (window.confirm(t("deleteVmConfirm", { name: selectedVm.name }))) {
                          handleDeleteVm(selectedVm.id);
                        }
                      }}
                      loading={actionLoading === `${selectedVm.id}-delete`}
                    />
                    <button
                      onClick={() => setSelectedVmId("")}
                      className="w-full rounded-md border border-gray-200 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50"
                    >
                       {t("backDashboard")}
                    </button>
                  </div>
                ) : (
                   <p className="text-[11px] text-gray-400">{t("selectVmActions")}</p>
                )
              )}

              {/* ── Resources tab ── */}
              {detailTab === "resources" && (
                selectedVm ? (
                  <div className="space-y-2.5">
                    {canAdmin ? (
                      <>
                         <Field label={t("memoryMb")}>
                          <input
                            type="number" min={512}
                            value={resourceDrafts[selectedVm.id]?.memoryMB ?? ""}
                            onChange={(e) => setResourceDrafts((p) => ({ ...p, [selectedVm.id]: { ...p[selectedVm.id], memoryMB: e.target.value } }))}
                            className={inputCls} placeholder={String(selectedVm.memoryMB ?? "")}
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="vCPU">
                            <input
                              type="number" min={1}
                              value={resourceDrafts[selectedVm.id]?.cpuCores ?? ""}
                              onChange={(e) => setResourceDrafts((p) => ({ ...p, [selectedVm.id]: { ...p[selectedVm.id], cpuCores: e.target.value } }))}
                              className={inputCls} placeholder={String(selectedVm.cpuCores ?? "")}
                            />
                          </Field>
                          <Field label={t("sockets")}>
                            <input
                              type="number" min={1}
                              value={resourceDrafts[selectedVm.id]?.sockets ?? ""}
                              onChange={(e) => setResourceDrafts((p) => ({ ...p, [selectedVm.id]: { ...p[selectedVm.id], sockets: e.target.value } }))}
                              className={inputCls} placeholder={String(selectedVm.sockets ?? "")}
                            />
                          </Field>
                        </div>
                        {selectedVm.status?.toLowerCase?.() === "up" ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                             {t("vmMustBeOff")}
                            <button
                              onClick={() => runAction(selectedVm.id, "shutdown")}
                              disabled={actionLoading === `${selectedVm.id}-shutdown`}
                              className="mt-1 w-full rounded-md border border-amber-300 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            >
                               {t("shutDownNow")}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => updateResources(selectedVm.id)}
                            disabled={actionLoading === `${selectedVm.id}-update`}
                            className="w-full rounded-md bg-blue-600 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                          >
                             {actionLoading === `${selectedVm.id}-update` ? t("updating") : t("updateResources")}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="rounded-md border p-2 text-center" style={{ borderColor: "var(--border)" }}>
                          <p className="text-sm font-bold text-gray-800">{selectedVm.memoryMB ?? "—"}</p>
                          <p className="text-[9px] text-gray-400">RAM MB</p>
                        </div>
                        <div className="rounded-md border p-2 text-center" style={{ borderColor: "var(--border)" }}>
                          <p className="text-sm font-bold text-gray-800">{selectedVm.cpuCores ?? "—"}</p>
                          <p className="text-[9px] text-gray-400">vCPU</p>
                        </div>
                        <div className="rounded-md border p-2 text-center" style={{ borderColor: "var(--border)" }}>
                          <p className="text-sm font-bold text-gray-800">{selectedVm.sockets ?? "—"}</p>
                          <p className="text-[9px] text-gray-400">{t("sockets")}</p>
                        </div>
                      </div>
                    )}

                    {vmDiskList.length > 0 && (
                      <>
                        <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                         <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("disks")}</p>
                        <div className="space-y-1">
                          {vmDiskList.map((disk) => (
                            <div key={disk.attachmentId} className="flex items-center gap-1.5 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                              <span className="flex-1 truncate text-[10px] font-medium text-gray-700">{disk.name}</span>
                              <span className="text-[10px] text-gray-500">{formatNumber(disk.sizeGB, { maximumFractionDigits: 0 })} GB</span>
                              <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-500">{disk.interface || "?"}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Redes */}
                    <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
                    <div className="flex items-center justify-between">
                       <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("networks")}</p>
                      {canAdmin && vmNics.some(n => !n.plugged) && (
                        <button
                          onClick={() => vmNics.filter(n => !n.plugged).forEach(n => handleToggleNic(selectedVm.id, n.id, true))}
                          disabled={actionLoading === `${selectedVm.id}-nic`}
                          className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                        >
                           {t("connectAll")}
                        </button>
                      )}
                    </div>
                    {vmNics.length > 0 && (
                      <div className="space-y-1">
                        {vmNics.map((n) => {
                          const isOn = n.plugged && n.linked;
                          return (
                          <div key={n.id} className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                            <div className="flex items-center gap-1.5">
                               <span className={`h-2 w-2 shrink-0 rounded-full ${isOn ? "bg-emerald-500" : n.plugged ? "bg-amber-400" : "bg-gray-300"}`} title={isOn ? t("connected") : n.plugged ? t("pluggedNoLink") : t("disconnected")} />
                              <span className="flex-1 truncate text-[10px] font-medium text-gray-700">{n.name}</span>
                              <span className="shrink-0 text-[10px] text-gray-500">{n.networkName || "?"}</span>
                              {n.ipv4 && (
                                <span className="shrink-0 rounded bg-blue-50 px-1 text-[9px] font-medium text-blue-600">{n.ipv4}</span>
                              )}
                              {canAdmin && (
                                <>
                                  <button
                                    onClick={() => handleToggleNic(selectedVm.id, n.id, !isOn)}
                                    disabled={actionLoading === `${selectedVm.id}-nic`}
                                    className={`shrink-0 rounded border px-1 py-0.5 text-[9px] disabled:opacity-50 ${isOn ? "border-amber-200 text-amber-600 hover:bg-amber-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
                                  >
                                    {isOn ? "Off" : "On"}
                                  </button>
                                  <button
                                     onClick={() => { if (window.confirm(t("deleteNicConfirm", { name: n.name }))) handleDeleteNic(selectedVm.id, n.id); }}
                                    disabled={actionLoading === `${selectedVm.id}-nic`}
                                    className="shrink-0 rounded border border-red-200 px-1 py-0.5 text-[9px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  >
                                     {t("deleteShort")}
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="mt-0.5 flex gap-2 pl-3.5 text-[9px] text-gray-400">
                              <span>{n.mac?.slice(0, 17)}</span>
                              <span>{n.interface}</span>
                               <span className={isOn ? "text-emerald-500" : "text-gray-400"}>{isOn ? `● ${t("active")}` : n.plugged ? "◐ Plugged" : `○ ${t("disconnected")}`}</span>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                    {canAdmin && <div className="flex gap-1.5">
                      <select
                        value=""
                        onChange={(e) => e.target.value && handleAddNic(selectedVm.id, e.target.value)}
                        disabled={actionLoading === `${selectedVm.id}-nic`}
                        className="flex-1 rounded-md border px-2 py-1.5 text-[11px] disabled:opacity-50"
                        style={{ borderColor: "var(--border)" }}
                      >
                         <option value="">{actionLoading === `${selectedVm.id}-nic` ? t("adding") : t("addNic")}</option>
                        {provVnicProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.networkName} ({p.name}){netConfig[p.networkName]?.prefix ? ` — ${netConfig[p.networkName].prefix}.x / ${netConfig[p.networkName].mask}` : ""}</option>
                        ))}
                      </select>
                    </div>}
                  </div>
                ) : (
                   <p className="text-[11px] text-gray-400">{t("selectVmResources")}</p>
                )
              )}

              {/* ── Provisioning tab ── */}
              {detailTab === "provisioning" && (
                !canAdmin ? (
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Storage domains</p>
                    {storageDomains.length > 0 ? storageDomains.map((domain) => (
                      <div key={domain.id} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
                        <div className="flex justify-between gap-2 text-[11px]">
                          <span className="truncate font-medium text-gray-700">{domain.name}</span>
                          <span className="text-gray-400">{domain.status ?? domain.type}</span>
                        </div>
                         <p className="mt-1 text-[10px] text-gray-500">{t("usedGb", { used: formatNumber(domain.usedGB), total: formatNumber(domain.totalGB) })}</p>
                      </div>
                     )) : <p className="text-[11px] text-gray-400">{t("noVisibleStorage")}</p>}

                    <div className="border-t" style={{ borderColor: "var(--border)" }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">ISOs</p>
                    {isoList.length > 0 ? isoList.map((iso) => (
                      <div key={iso.id} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
                        <p className="truncate text-[11px] font-medium text-gray-700">{iso.name}</p>
                         <p className="mt-0.5 text-[10px] text-gray-400">{iso.storageDomainName || t("unnamedStorage")} · {formatNumber(iso.sizeGB)} GB</p>
                      </div>
                     )) : <p className="text-[11px] text-gray-400">{t("noIsos")}</p>}

                    <div className="border-t" style={{ borderColor: "var(--border)" }} />
                     <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("ovaCatalog")}</p>
                    {ovaLibrary.length > 0 ? ovaLibrary.map((ova) => (
                      <div key={ova.id} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
                        <p className="truncate text-[11px] font-medium text-gray-700">{ova.name}</p>
                         <p className="mt-0.5 text-[10px] text-gray-400">{ova.storageDomainName || t("unnamedStorage")} · {formatNumber(ova.size / 1024 / 1024, { maximumFractionDigits: 0 })} MB</p>
                      </div>
                     )) : <p className="text-[11px] text-gray-400">{t("noOvas")}</p>}
                  </div>
                ) : (
                <div className="space-y-4">
                  <div>
                     <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t("originStep")}</p>
                     <Field label={t("vmType")}>
                      <select value={newVmSource} onChange={(e) => { setNewVmSource(e.target.value as "blank" | "template" | "ova"); setUploadedOva(null); }} className={inputCls}>
                         <option value="blank">{t("blankVm")}</option>
                         <option value="template">{t("existingTemplate")}</option>
                         <option value="ova">{t("importOva")}</option>
                      </select>
                    </Field>
                  </div>

                  {newVmSource === "ova" && (
                    <div>
                       <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t("selectOvaStep")}</p>
                      {uploadedOva ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold text-emerald-800">{uploadedOva.name}</p>
                              {uploadedOva.ovf && <p className="mt-0.5 truncate text-[10px] text-emerald-600">{uploadedOva.ovf}</p>}
                            </div>
                             <button onClick={() => setUploadedOva(null)} className="ml-2 shrink-0 text-[10px] text-emerald-700 underline">{t("change")}</button>
                          </div>
                        </div>
                      ) : ovaLibrary.length > 0 ? (
                        <div className="space-y-2">
                          <select
                            value=""
                            onChange={(e) => {
                              const entry = ovaLibrary.find((o) => o.id === e.target.value);
                              if (entry) setUploadedOva({ diskId: entry.id, name: entry.name });
                            }}
                            className={inputCls}
                          >
                             <option value="">{t("catalogCount", { count: ovaLibrary.length })}</option>
                            {ovaLibrary.map((o) => (
                              <option key={o.id} value={o.id}>{o.name} — {Math.round(o.size / 1024 / 1024)} MB</option>
                            ))}
                          </select>
                          {ovaUploadProgress !== null && (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] text-blue-700">
                               <div className="mb-1 flex justify-between"><span>{t("uploading")}</span><span>{ovaUploadProgress}%</span></div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${ovaUploadProgress}%` }} /></div>
                            </div>
                          )}
                          <div className="flex items-center gap-2 py-0.5">
                            <div className="h-px flex-1 bg-gray-200" />
                             <span className="text-[9px] text-gray-400">{t("uploadNew")}</span>
                            <div className="h-px flex-1 bg-gray-200" />
                          </div>
                          <label className={`flex cursor-pointer items-center justify-center rounded-md border border-gray-200 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 ${uploadingOva ? "pointer-events-none opacity-50" : ""}`}>
                             {uploadingOva ? t("uploading") : t("selectOvaFile")}
                            <input type="file" accept=".ova,.qcow2,application/x-tar" className="hidden" disabled={uploadingOva} onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleUploadOva(file); e.currentTarget.value = ""; }} />
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {ovaUploadProgress !== null && (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] text-blue-700">
                               <div className="mb-1 flex justify-between"><span>{t("uploading")}</span><span>{ovaUploadProgress}%</span></div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${ovaUploadProgress}%` }} /></div>
                            </div>
                          )}
                          <label className={`flex cursor-pointer items-center justify-center rounded-md border border-gray-200 py-3 text-[11px] font-medium text-gray-600 hover:bg-gray-50 ${uploadingOva ? "pointer-events-none opacity-50" : ""}`}>
                             {uploadingOva ? t("uploading") : t("selectOvaFile")}
                            <input type="file" accept=".ova,.qcow2,application/x-tar" className="hidden" disabled={uploadingOva} onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleUploadOva(file); e.currentTarget.value = ""; }} />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                     <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{newVmSource === "ova" ? t("configurationStep3") : t("configurationStep2")}</p>
                    <div className="space-y-2.5">
                       <Field label={t("nameRequired")}>
                        <input value={newVm.name} onChange={(e) => setNewVm((v) => ({ ...v, name: e.target.value }))}
                          className={inputCls} placeholder="vm-app-01" />
                      </Field>
                       {newVmSource !== "ova" && <Field label={t("osToInstall")}>
                        <select value={newVm.os} onChange={(e) => setNewVm((v) => ({ ...v, os: e.target.value }))}
                          className={inputCls}>
                          <option value="linux">Linux (virtio)</option>
                          <option value="windows">Windows (SATA + virtio drivers)</option>
                        </select>
                      </Field>}
                      <Field label="Cluster *">
                        <select value={newVm.clusterId} onChange={(e) => setNewVm((v) => ({ ...v, clusterId: e.target.value }))}
                          className={inputCls}>
                           <option value="">{t("selectCluster")}</option>
                          {provClusters.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </Field>
                      {newVmSource === "template" && <Field label="Template">
                        <select value={newVm.templateId} onChange={(e) => setNewVm((v) => ({ ...v, templateId: e.target.value }))}
                          className={inputCls}>
                           <option value="">{t("noTemplate")}</option>
                          {provTemplates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </Field>}
                      {newVmSource === "ova" && <Field label="Storage domain *">
                        <select value={ovaStorageDomainId} onChange={(e) => setOvaStorageDomainId(e.target.value)} className={inputCls}>
                           <option value="">{t("select")}</option>
                          {storageDomains.filter((sd) => sd.type === "data").map((sd) => (
                            <option key={sd.id} value={sd.id}>{sd.name}{sd.status ? ` (${sd.status})` : ""}</option>
                          ))}
                        </select>
                      </Field>}
                       {newVmSource === "ova" && <Field label={t("importHost")}>
                        <select value={ovaHostId} onChange={(e) => setOvaHostId(e.target.value)} className={inputCls}>
                           <option value="">{t("select")}</option>
                          {provHosts.map((h) => (
                            <option key={h.id} value={h.id}>{h.name}{h.address ? ` (${h.address})` : ""}</option>
                          ))}
                        </select>
                      </Field>}
                       {newVmSource !== "ova" && <Field label={t("networkRequired")}>
                        <select value={newVm.vnicProfileId} onChange={(e) => setNewVm((v) => ({ ...v, vnicProfileId: e.target.value }))}
                          className={inputCls}>
                           <option value="">{t("selectNetwork")}</option>
                          {provVnicProfiles.map((p) => (
                            <option key={p.id} value={p.id}>{p.networkName} ({p.name}){netConfig[p.networkName]?.prefix ? ` — ${netConfig[p.networkName].prefix}.x / ${netConfig[p.networkName].mask}` : ""}</option>
                          ))}
                        </select>
                      </Field>}
                      {newVmSource !== "ova" && newVm.vnicProfileId && (
                        <label className="flex items-center gap-2 text-[10px] text-gray-500">
                          <input type="checkbox" checked={useCloudInit} onChange={(e) => setUseCloudInit(e.target.checked)} className="h-3 w-3" />
                           {t("configureAutomaticIp")}
                        </label>
                      )}
                      {newVmSource !== "ova" && useCloudInit && (
                        <div className="grid grid-cols-2 gap-2 rounded-md border border-blue-100 bg-blue-50 p-2.5">
                          <Field label="IP">
                            <input value={cloudInit.ip}
                              onChange={(e) => setCloudInit((v) => ({ ...v, ip: e.target.value }))}
                              className={inputCls} placeholder={netConfig[provVnicProfiles.find(p => p.id === newVm.vnicProfileId)?.networkName ?? ""]?.prefix ? `${netConfig[provVnicProfiles.find(p => p.id === newVm.vnicProfileId)?.networkName ?? ""].prefix}.100` : "192.168.1.100"} />
                          </Field>
                           <Field label={t("netmask")}>
                            <input value={cloudInit.netmask}
                              onChange={(e) => setCloudInit((v) => ({ ...v, netmask: e.target.value }))}
                              className={inputCls} placeholder={netConfig[provVnicProfiles.find(p => p.id === newVm.vnicProfileId)?.networkName ?? ""]?.mask ?? "255.255.255.0"} />
                          </Field>
                          <Field label="Gateway">
                            <input value={cloudInit.gateway}
                              onChange={(e) => setCloudInit((v) => ({ ...v, gateway: e.target.value }))}
                              className={inputCls} placeholder={netConfig[provVnicProfiles.find(p => p.id === newVm.vnicProfileId)?.networkName ?? ""]?.prefix ? `${netConfig[provVnicProfiles.find(p => p.id === newVm.vnicProfileId)?.networkName ?? ""].prefix}.1` : "192.168.1.1"} />
                          </Field>
                          <Field label="DNS">
                            <input value={cloudInit.dns}
                              onChange={(e) => setCloudInit((v) => ({ ...v, dns: e.target.value }))}
                              className={inputCls} placeholder="8.8.8.8" />
                          </Field>
                        </div>
                      )}
                      {newVmSource !== "ova" && <>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="RAM (MB)">
                            <input type="number" min={512} value={newVm.memoryMB}
                              onChange={(e) => setNewVm((v) => ({ ...v, memoryMB: e.target.value }))}
                              className={inputCls} placeholder="4096" />
                          </Field>
                          <Field label="vCPU">
                            <input type="number" min={1} value={newVm.cpuCores}
                              onChange={(e) => setNewVm((v) => ({ ...v, cpuCores: e.target.value }))}
                              className={inputCls} placeholder="2" />
                          </Field>
                        </div>
                        <Field label={t("sockets")}>
                          <input type="number" min={1} value={newVm.sockets}
                            onChange={(e) => setNewVm((v) => ({ ...v, sockets: e.target.value }))}
                            className={inputCls} placeholder="1" />
                        </Field>
                         <Field label={t("comment")}>
                          <textarea value={newVm.comment}
                            onChange={(e) => setNewVm((v) => ({ ...v, comment: e.target.value }))}
                             className={`${inputCls} resize-none`} placeholder={t("commentPlaceholder")} rows={2} />
                        </Field>
                      </>}
                    </div>
                  </div>

                  {ovaImportProgress !== null && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-700">
                      <div className="mb-1.5 flex justify-between font-medium">
                         <span>{ovaImportProgress < 40 ? t("copyingOva") : ovaImportProgress < 75 ? t("importingOlvm") : t("waitingConversion")}</span>
                        <span>{Math.round(ovaImportProgress)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-1000" style={{ width: `${ovaImportProgress}%` }} />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleNewVm}
                    disabled={actionLoading === "create"}
                    className="w-full rounded-md bg-blue-600 py-2 text-[12px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                     {actionLoading === "create" ? (newVmSource === "ova" ? t("importingOva") : t("creating")) : t("createVm")}
                  </button>
                </div>
                )
              )}

              {/* ── Console tab ── */}
              {detailTab === "console" && (
                <div className="space-y-2.5">
                   <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("console")}</p>
                  {selectedVm ? (
                    <>
                      <div className="rounded-md border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                        <div className="bg-black relative" style={{ aspectRatio: "16/9", minHeight: 140 }}>
                          {consolePreviewLoading ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                               <p className="mt-1.5 text-[10px]">{t("generatingPreview")}</p>
                            </div>
                          ) : selectedVm.status === "up" && consolePreviewIframe ? (
                            <iframe
                              src={consolePreviewIframe}
                              className="h-full w-full border-0 opacity-90"
                              title={`${t("consolePreview")} ${selectedVm.id}`}
                              style={{ pointerEvents: "none" }}
                            />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60">
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                <path d="M8 21h8M12 17v4"/>
                              </svg>
                              <p className="mt-1.5 text-xs">
                                 {selectedVm.status === "up" ? t("previewUnavailable") : t("vmOff")}
                              </p>
                            </div>
                          )}
                          {selectedVm.status === "up" && (
                            <div className="absolute bottom-1.5 right-1.5">
                              <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-emerald-400">●</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-gray-900">{selectedVm.name}</p>
                            <p className="text-[10px] text-gray-500">
                               {selectedVm.status === "up" ? t("running") : selectedVm.status}
                            </p>
                          </div>
                          <StatusBadge status={selectedVm.status} />
                        </div>
                      </div>
                      {selectedVm.status === "up" && !consolePreviewIframe && !consolePreviewLoading && (
                        <button
                          onClick={() => generateConsolePreview(selectedVm.id)}
                          className="w-full rounded-md border border-gray-200 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                        >
                           {t("generatePreview")}
                        </button>
                      )}
                      {selectedVm.status === "up" ? (
                        <button
                          onClick={() => { setConsolePreviewIframe(null); openEmbeddedConsole(selectedVm.id); }}
                          disabled={consoleLoading === selectedVm.id || embeddedConsole.status === "connecting"}
                          className="w-full rounded-md bg-blue-600 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                        >
                          {consoleLoading === selectedVm.id || embeddedConsole.status === "connecting"
                             ? t("connecting")
                             : t("openFullConsole")}
                        </button>
                      ) : (
                        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">
                           {t("startForConsole")}
                        </p>
                      )}
                    </>
                  ) : (
                     <p className="text-xs text-gray-400">{t("selectVmConsole")}</p>
                  )}
                </div>
              )}

            </div>
          </aside>
        </div>
      </div>

      {/* ── Clone wizard modal ─────────────────────────────────────────── */}
      {canAdmin && cloneWizard.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border bg-white p-5 shadow-xl" style={{ borderColor: "var(--border)" }}>
             <h2 className="text-sm font-bold text-gray-900">{t("cloneVm")}</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
               {t("cloneSourceDescription", { name: cloneWizard.sourceVmName })}
            </p>
             <Field label={t("newName")}>
              <input
                value={cloneWizard.newName}
                onChange={(e) => setCloneWizard((p) => ({ ...p, newName: e.target.value, error: null }))}
                disabled={cloneWizard.submitting}
                className={`mt-1 ${inputCls}`} placeholder="vm-clone-01"
              />
            </Field>
            {cloneWizard.error && (
              <p className="mt-2 text-[11px] text-red-600">{cloneWizard.error}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeCloneWizard}
                disabled={cloneWizard.submitting}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
               >{t("cancel")}</button>
              <button
                onClick={submitCloneWizard}
                disabled={cloneWizard.submitting}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
               >{cloneWizard.submitting ? t("cloning") : t("clone")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Embedded console modal ─────────────────────────────────────── */}
      {canOperate && showExperimentalConsole && embeddedConsole.status !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex flex-col rounded-xl border bg-white shadow-xl" style={{ borderColor: "var(--border)", width: "min(88vw, calc((78vh - 54px) * 16 / 9))", maxHeight: "78vh" }}>
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
              <div>
                 <p className="text-[11px] text-gray-500">{t("embeddedConsole")}</p>
                <p className="text-sm font-semibold text-gray-900">{selectedVm?.name ?? embeddedConsole.vmId}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} className="h-3 w-3" />
                   {t("localWsProxy")}
                </label>
                <button
                  onClick={closeEmbeddedConsole}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium hover:bg-gray-50"
                 >{t("close")}</button>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-b-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
              {embeddedConsole.iframeUrl && (
                <iframe src={embeddedConsole.iframeUrl} className="h-full w-full border-0" title={`${t("console")} ${embeddedConsole.vmId}`} />
              )}
              {embeddedConsole.status === "connecting" && !embeddedConsole.iframeUrl && (
                 <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">{t("connecting")}</div>
              )}
              {embeddedConsole.status === "error" && (
                 <div className="absolute inset-0 flex items-center justify-center text-sm text-red-300">{embeddedConsole.error ?? t("consoleError")}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
