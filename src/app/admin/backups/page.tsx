"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import { adminMessages } from "@/i18n/admin";

type Frequency = "manual" | "6h" | "12h" | "daily" | "weekly" | "monthly";
type Profile = "operational" | "full";

type BackupConfig = {
  provider: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  enabled: boolean;
  scheduleEnabled: boolean;
  frequency: Frequency;
  scheduleHour: number;
  scheduleWeekday: number;
  retentionDays: number;
  retentionCount: number;
  defaultProfile: Profile;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  accessKeyHint: string | null;
  secretKeyHint: string | null;
  lastScheduledAt: string | null;
  nextRunAt: string | null;
};

type BackupForm = Omit<BackupConfig, "hasAccessKey" | "hasSecretKey" | "accessKeyHint" | "secretKeyHint" | "lastScheduledAt" | "nextRunAt"> & {
  accessKey: string;
  secretKey: string;
};

type BackupJob = {
  id: string;
  profile: Profile;
  trigger: "manual" | "scheduled";
  status: "queued" | "running" | "completed" | "failed" | "expired";
  stage: string;
  progress: number;
  requestedBy: string;
  objectKey: string | null;
  sizeBytes: string | number | null;
  checksum: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

const emptyForm: BackupForm = {
  provider: "s3",
  endpoint: "https://s3.us-central-1.wasabisys.com",
  region: "us-central-1",
  bucket: "",
  prefix: "backups/bastion",
  accessKey: "",
  secretKey: "",
  forcePathStyle: true,
  enabled: true,
  scheduleEnabled: false,
  frequency: "daily",
  scheduleHour: 2,
  scheduleWeekday: 0,
  retentionDays: 30,
  retentionCount: 30,
  defaultProfile: "operational",
};

const inputClass = "mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50 disabled:text-gray-400";
const labelClass = "block text-[11px] font-semibold uppercase tracking-wide text-gray-500";

const parseResponse = async (response: Response) => {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; }
  catch { return text ? { error: text } : null; }
};

export default function AdminBackupsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations(adminMessages);
  const { locale } = useLocale();
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [form, setForm] = useState<BackupForm>(emptyForm);
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [starting, setStarting] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSuperadmin = session?.user?.globalRole === "superadmin" || session?.user?.role === "superadmin";
  const activeJob = jobs.some((job) => job.status === "queued" || job.status === "running");

  const applyConfig = (next: BackupConfig | null) => {
    setConfig(next);
    if (!next) {
      setForm(emptyForm);
      return;
    }
    setForm({
      provider: next.provider,
      endpoint: next.endpoint,
      region: next.region,
      bucket: next.bucket,
      prefix: next.prefix,
      accessKey: "",
      secretKey: "",
      forcePathStyle: next.forcePathStyle,
      enabled: next.enabled,
      scheduleEnabled: next.scheduleEnabled,
      frequency: next.frequency,
      scheduleHour: next.scheduleHour,
      scheduleWeekday: next.scheduleWeekday,
      retentionDays: next.retentionDays,
      retentionCount: next.retentionCount,
      defaultProfile: next.defaultProfile,
    });
  };

  const loadConfig = useCallback(async () => {
    const response = await fetch("/api/admin/backup-storage", { cache: "no-store" });
    const data = await parseResponse(response);
    if (!response.ok) throw new Error(data?.error ?? t("backupLoadError"));
    applyConfig(data);
  }, [locale]);

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/backups", { cache: "no-store" });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error ?? t("backupHistoryError"));
      setJobs(Array.isArray(data) ? data : data?.jobs ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/"); return; }
    Promise.all([loadConfig(), loadJobs()])
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false));
  }, [status, session, isSuperadmin, router, loadConfig, loadJobs]);

  useEffect(() => {
    if (!isSuperadmin || loading) return;
    const timer = window.setInterval(loadJobs, activeJob ? 3000 : 15000);
    return () => window.clearInterval(timer);
  }, [isSuperadmin, loading, activeJob, loadJobs]);

  useEffect(() => {
    if (!error && !success) return;
    const timer = window.setTimeout(() => { setError(null); setSuccess(null); }, 8000);
    return () => window.clearTimeout(timer);
  }, [error, success]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null); setSuccess(null);
    try {
      const payload = { ...form, accessKey: form.accessKey || undefined, secretKey: form.secretKey || undefined };
      const response = await fetch("/api/admin/backup-storage", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error ?? t("saveError"));
      applyConfig(data);
      setSuccess(t("backupSaved"));
    } catch (caught) { setError((caught as Error).message); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/admin/backup-storage/test", { method: "POST" });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error ?? t("testFailed"));
      setSuccess(data?.detail ?? t("backupTestSuccess"));
    } catch (caught) { setError((caught as Error).message); }
    finally { setTesting(false); }
  };

  const deleteConfig = async () => {
    setDeleting(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/admin/backup-storage", { method: "DELETE" });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error ?? t("deleteError"));
      applyConfig(null);
      setShowDelete(false);
      setSuccess(t("backupDeleted"));
    } catch (caught) { setError((caught as Error).message); }
    finally { setDeleting(false); }
  };

  const startBackup = async (profile: Profile) => {
    setStarting(profile); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error ?? t("backupStartError"));
      setSuccess(t("backupQueued"));
      await loadJobs();
    } catch (caught) { setError((caught as Error).message); }
    finally { setStarting(null); }
  };

  const update = <K extends keyof BackupForm>(key: K, value: BackupForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dateLocale = { es: "es-ES", en: "en-GB", de: "de-DE", pt: "pt-PT" }[locale];
  const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("backupNever");
  const formatSize = (value: string | number | null) => {
    if (value === null) return "-";
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return String(value);
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = bytes / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size.toLocaleString(dateLocale, { maximumFractionDigits: 1 })} ${units[unit]}`;
  };

  const filteredJobs = useMemo(() => {
    const term = historySearch.trim().toLowerCase();
    const sorted = [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (!term) return sorted.slice(0, 7);
    return sorted.filter((job) => {
      const haystack = [
        job.id,
        job.profile,
        job.status,
        job.trigger,
        job.requestedBy,
        job.stage,
        job.objectKey,
        job.checksum,
        job.error,
        job.createdAt,
        job.startedAt,
        job.finishedAt,
        formatDate(job.createdAt),
        formatDate(job.startedAt),
        formatDate(job.finishedAt),
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0 && value !== t("backupNever"))
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [jobs, historySearch, formatDate, t]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500" style={{ background: "var(--bg)" }}>{t("loading")}</div>;
  if (!isSuperadmin) return null;

  const manualDisabled = !config || !config.enabled || activeJob || starting !== null;
  const statusClass = (jobStatus: string) => jobStatus === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : jobStatus === "failed" ? "border-red-200 bg-red-50 text-red-700" : jobStatus === "expired" ? "border-gray-200 bg-gray-100 text-gray-500" : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1 text-[13px] font-semibold text-gray-800">
              <button onClick={() => router.push("/")} className="flex items-center gap-1 hover:text-blue-600" title={t("home")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z"/><path d="M6 14.5V9h4v5.5"/></svg>
                OLVM-PORTAL
              </button>
              <span className="text-gray-400">/</span>
              <button onClick={() => router.push("/admin/clusters")} className="text-gray-600 hover:text-blue-600">{t("settings")}</button>
              <span className="text-gray-400">/</span><span>{t("backups")}</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{t("backupsTitle")}</h1>
            <p className="text-xs text-gray-500">{t("backupsSubtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NavButton label={t("clusters")} onClick={() => router.push("/admin/clusters")} />
            <NavButton label={t("users")} onClick={() => router.push("/admin/users")} />
            <NavButton label={t("email")} onClick={() => router.push("/admin/email")} />
            <NavButton label={t("branding")} onClick={() => router.push("/admin/branding")} />
            <LanguageSelector />
          </div>
        </header>

        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
          <form onSubmit={save} className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
            <SectionHeader title={t("backupStorageTitle")} subtitle={t("backupStorageSubtitle")} />
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className={labelClass}>{t("provider")}</span>
                  <div className="mt-1 flex h-[38px] items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700">
                    <span className="font-semibold">S3</span><span className="text-gray-300">/</span><span>Wasabi</span>
                  </div>
                </div>
                <label><span className={labelClass}>{t("backupEndpoint")}</span><input type="url" required pattern="https://.*" value={form.endpoint} onChange={(e) => update("endpoint", e.target.value)} placeholder="https://s3.example.com" className={inputClass} /><span className="mt-1 block text-[10px] text-gray-400">{t("backupHttpsOnly")}</span></label>
                <label><span className={labelClass}>{t("backupRegion")}</span><input required value={form.region} onChange={(e) => update("region", e.target.value)} placeholder="us-central-1" className={inputClass} /></label>
                <label><span className={labelClass}>{t("backupBucket")}</span><input required value={form.bucket} onChange={(e) => update("bucket", e.target.value)} placeholder="olvm-portal" className={inputClass} /></label>
                <label className="sm:col-span-2"><span className={labelClass}>{t("backupPrefix")}</span><input value={form.prefix} onChange={(e) => update("prefix", e.target.value)} placeholder="backups/portal" className={inputClass} /></label>
                <label><span className={labelClass}>{t("backupAccessKey")}</span><input type="password" required={!config?.hasAccessKey} value={form.accessKey} onChange={(e) => update("accessKey", e.target.value)} placeholder={config?.hasAccessKey ? t("currentKeep", { value: config.accessKeyHint ?? "****" }) : "Access Key"} className={inputClass} />{config?.hasAccessKey && <span className="mt-1 block text-[10px] text-emerald-600">{t("backupCredentialSaved", { hint: config.accessKeyHint ?? "****" })}</span>}</label>
                <label><span className={labelClass}>{t("backupSecretKey")}</span><input type="password" required={!config?.hasSecretKey} value={form.secretKey} onChange={(e) => update("secretKey", e.target.value)} placeholder={config?.hasSecretKey ? t("currentKeep", { value: config.secretKeyHint ?? "****" }) : "Secret Key"} className={inputClass} />{config?.hasSecretKey && <span className="mt-1 block text-[10px] text-emerald-600">{t("backupCredentialSaved", { hint: config.secretKeyHint ?? "****" })}</span>}</label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle checked={form.forcePathStyle} onChange={(value) => update("forcePathStyle", value)} title={t("backupPathStyle")} description={t("backupPathStyleHelp")} />
                <Toggle checked={form.enabled} onChange={(value) => update("enabled", value)} title={t("backupStorageEnabled")} description={t("backupStorageEnabledHelp")} />
              </div>
            </div>

            <div className="border-t" style={{ borderColor: "var(--border)" }}><SectionHeader title={t("backupScheduleTitle")} subtitle={t("backupScheduleSubtitle")} /></div>
            <div className="space-y-4 p-5">
              <Toggle checked={form.scheduleEnabled} onChange={(value) => update("scheduleEnabled", value)} title={t("backupScheduleEnabled")} description={t("backupScheduleUtc")} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label><span className={labelClass}>{t("backupFrequency")}</span><select value={form.frequency} onChange={(e) => update("frequency", e.target.value as Frequency)} className={inputClass}><option value="manual">{t("backupFrequencyManual")}</option><option value="6h">{t("backupFrequency6h")}</option><option value="12h">{t("backupFrequency12h")}</option><option value="daily">{t("backupFrequencyDaily")}</option><option value="weekly">{t("backupFrequencyWeekly")}</option><option value="monthly">{t("backupFrequencyMonthly")}</option></select></label>
                <label><span className={labelClass}>{t("backupHourUtc")}</span><input type="number" min={0} max={23} required value={form.scheduleHour} onChange={(e) => update("scheduleHour", Number(e.target.value))} disabled={form.frequency === "manual" || form.frequency === "6h" || form.frequency === "12h"} className={inputClass} /></label>
                {form.frequency === "weekly" && <label><span className={labelClass}>{t("backupWeekday")}</span><select value={form.scheduleWeekday} onChange={(e) => update("scheduleWeekday", Number(e.target.value))} className={inputClass}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{t(`backup${day}`)}</option>)}</select></label>}
                <label><span className={labelClass}>{t("backupDefaultProfile")}</span><select value={form.defaultProfile} onChange={(e) => update("defaultProfile", e.target.value as Profile)} className={inputClass}><option value="operational">{t("backupOperational")}</option><option value="full">{t("backupFull")}</option></select></label>
                <label><span className={labelClass}>{t("backupRetentionDays")}</span><input type="number" min={1} max={3650} required value={form.retentionDays} onChange={(e) => update("retentionDays", Number(e.target.value))} className={inputClass} /></label>
                <label><span className={labelClass}>{t("backupRetentionCount")}</span><input type="number" min={1} max={1000} required value={form.retentionCount} onChange={(e) => update("retentionCount", Number(e.target.value))} className={inputClass} /></label>
              </div>
              <div className="grid gap-2 rounded-lg bg-gray-50 p-3 text-xs sm:grid-cols-2">
                <div><span className="text-gray-400">{t("backupNextRun")}</span><p className="mt-0.5 font-medium text-gray-700">{formatDate(config?.nextRunAt ?? null)}</p></div>
                <div><span className="text-gray-400">{t("backupLastScheduled")}</span><p className="mt-0.5 font-medium text-gray-700">{formatDate(config?.lastScheduledAt ?? null)}</p></div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
              <button type="button" onClick={() => setShowDelete(true)} disabled={!config || deleting} className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">{t("backupDeleteConfig")}</button>
              <div className="flex gap-2">
                <button type="button" onClick={testConnection} disabled={!config || testing || saving} title={!config ? t("backupTestSaveFirst") : undefined} className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 sm:flex-none">{testing ? t("testing") : t("testConnection")}</button>
                <button type="submit" disabled={saving} className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:flex-none">{saving ? t("saving") : t("saveConfiguration")}</button>
              </div>
            </div>
          </form>

          <aside className="space-y-5">
            <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold text-gray-900">{t("backupManualTitle")}</h2><p className="mt-1 text-[11px] text-gray-500">{t("backupManualSubtitle")}</p>
              <div className="mt-4 grid gap-2">
                <button onClick={() => startBackup("operational")} disabled={manualDisabled} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{starting === "operational" ? t("backupStarting") : t("backupRunOperational")}</button>
                <button onClick={() => startBackup("full")} disabled={manualDisabled} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40">{starting === "full" ? t("backupStarting") : t("backupRunFull")}</button>
              </div>
              {(!config || !config.enabled) && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{t("backupManualDisabled")}</p>}
              {activeJob && <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-[11px] text-blue-700">{t("backupActiveNotice")}</p>}
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-xs text-blue-950">
              <h2 className="font-bold">{t("backupContentsTitle")}</h2>
              <div className="mt-3 space-y-3">
                <div><p className="font-semibold">{t("backupOperational")}</p><p className="mt-0.5 text-blue-800">{t("backupOperationalContents")}</p></div>
                <div><p className="font-semibold">{t("backupFull")}</p><p className="mt-0.5 text-blue-800">{t("backupFullContents")}</p></div>
                <div className="border-t border-blue-200 pt-3"><p className="font-semibold">{t("backupExcludedTitle")}</p><p className="mt-0.5 text-blue-800">{t("backupExcludedContents")}</p></div>
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><p className="font-bold">{t("backupBootstrapTitle")}</p><p className="mt-1">{t("backupBootstrapWarning")}</p></div>
          </aside>
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{t("backupHistoryTitle")}</h2>
              <p className="text-[11px] text-gray-400">{activeJob ? t("backupPollingActive") : t("backupPollingIdle")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                <input type="text" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder={t("backupSearchPlaceholder")} className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-7 text-xs text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 sm:w-72" />
                {historySearch && <button onClick={() => setHistorySearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-gray-400 hover:text-gray-600">✕</button>}
                <p className="mt-1 text-[10px] text-gray-400">{t("backupSearchHint")}</p>
              </div>
              <button onClick={loadJobs} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("backupRefresh")}</button>
            </div>
          </div>
          {!historyLoading && jobs.length > 0 && (
            <div className="border-b bg-gray-50 px-5 py-2 text-[11px] text-gray-500" style={{ borderColor: "var(--border)" }}>
              {historySearch.trim() ? t("backupSearchResults", { count: String(filteredJobs.length) }) : t("backupShowingRecent", { shown: String(filteredJobs.length), total: String(jobs.length) })}
            </div>
          )}
          {historyLoading ? <div className="px-5 py-12 text-center text-sm text-gray-400">{t("backupHistoryLoading")}</div> : filteredJobs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-gray-600">{historySearch.trim() ? t("backupSearchNoResults") : t("backupHistoryEmpty")}</p>
              {!historySearch.trim() && <p className="mt-1 text-xs text-gray-400">{t("backupHistoryEmptyHelp")}</p>}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {filteredJobs.map((job) => <article key={job.id} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusClass(job.status)}`}>{t(`backupStatus${job.status[0].toUpperCase()}${job.status.slice(1)}`)}</span><span className="text-sm font-semibold text-gray-900">{job.profile === "full" ? t("backupFull") : t("backupOperational")}</span><span className="text-[11px] text-gray-400">{job.trigger === "scheduled" ? t("backupScheduled") : t("backupManual")}</span></div><p className="mt-1 truncate font-mono text-[10px] text-gray-400" title={job.id}>{job.id}</p></div>
                  <div className="text-left text-[11px] text-gray-500 sm:text-right"><p>{formatDate(job.createdAt)}</p><p>{t("backupRequestedBy", { requester: job.requestedBy })}</p></div>
                </div>
                {(job.status === "queued" || job.status === "running") && <div className="mt-3"><div className="mb-1 flex justify-between text-[10px] font-medium text-gray-500"><span>{t(`backupStage${job.stage[0].toUpperCase()}${job.stage.slice(1)}`)}</span><span>{job.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div></div>}
                <div className="mt-3 grid gap-2 text-[11px] text-gray-500 sm:grid-cols-2 lg:grid-cols-4"><div><span className="block text-[10px] uppercase text-gray-400">{t("backupStarted")}</span>{formatDate(job.startedAt)}</div><div><span className="block text-[10px] uppercase text-gray-400">{t("backupFinished")}</span>{formatDate(job.finishedAt)}</div><div><span className="block text-[10px] uppercase text-gray-400">{t("backupSize")}</span>{formatSize(job.sizeBytes)}</div><div><span className="block text-[10px] uppercase text-gray-400">{t("backupStage")}</span>{t(`backupStage${job.stage[0].toUpperCase()}${job.stage.slice(1)}`)}</div></div>
                {(job.objectKey || job.checksum) && <div className="mt-3 grid gap-2 rounded-md bg-gray-50 p-3 text-[10px] sm:grid-cols-2">{job.objectKey && <div className="min-w-0"><span className="font-semibold text-gray-500">{t("backupObjectKey")}</span><code className="mt-0.5 block break-all text-gray-600">{job.objectKey}</code></div>}{job.checksum && <div className="min-w-0"><span className="font-semibold text-gray-500">SHA-256</span><code className="mt-0.5 block break-all text-gray-600">{job.checksum}</code></div>}</div>}
                {job.error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><span className="font-semibold">{t("genericError")}:</span> {job.error}</div>}
              </article>)}
            </div>
          )}
        </section>
      </div>

      {showDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setShowDelete(false)}><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><h2 className="text-base font-semibold text-gray-900">{t("backupDeleteTitle")}</h2><p className="mt-2 text-sm text-gray-600">{t("backupDeleteConfirm")}</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowDelete(false)} disabled={deleting} className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600">{t("cancel")}</button><button onClick={deleteConfig} disabled={deleting} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{deleting ? t("deleting") : t("backupDeleteConfig")}</button></div></div></div>}
    </div>
  );
}

function NavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{label}</button>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="bg-gray-50 px-5 py-4"><h2 className="text-sm font-bold text-gray-900">{title}</h2><p className="text-[11px] text-gray-500">{subtitle}</p></div>;
}

function Toggle({ checked, onChange, title, description }: { checked: boolean; onChange: (value: boolean) => void; title: string; description: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5"><span><span className="block text-xs font-medium text-gray-700">{title}</span><span className="block text-[10px] text-gray-400">{description}</span></span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>;
}
