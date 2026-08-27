"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslations } from "@/components/LocaleProvider";
import { adminMessages } from "@/i18n/admin";

/* ── Types ────────────────────────────────────────────────────────────── */

type Engine = {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: "basic" | "token";
  username?: string;
  hasPassword: boolean;
  hasToken: boolean;
  allowInsecure: boolean;
  hasCa: boolean;
  sharedStorageDomains?: string[];
  brandName?: string;
  brandLogoUrl?: string;
  createdAt: string;
};

type Tenant = {
  id: string;
  name: string;
  engineId: string;
  engineName: string;
  engineUrl: string;
  tag?: string;
  storageDomains?: string[];
  networks?: string[];
  networkConfig?: { name: string; prefix: string; mask: string }[];
  createdAt: string;
};

type EngineModal =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; engine: Engine }
  | { type: "delete"; engine: Engine };

type TenantModal =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; tenant: Tenant }
  | { type: "delete"; tenant: Tenant };

type TestResult = { ok: boolean; detail: string } | null;

const json = async (res: Response) => {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const inputCls =
  "w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30";
const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-gray-500";

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function AdminClustersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations(adminMessages);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [engineModal, setEngineModal] = useState<EngineModal>({ type: "closed" });
  const [tenantModal, setTenantModal] = useState<TenantModal>({ type: "closed" });
  const [rowTest, setRowTest] = useState<Record<string, TestResult>>({});

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  const load = useCallback(async () => {
    try {
      const [eRes, tRes] = await Promise.all([
        fetch("/api/admin/engines"),
        fetch("/api/admin/clusters"),
      ]);
      if (eRes.ok) setEngines(await json(eRes));
      if (tRes.ok) setTenants(await json(tRes));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/"); return; }
    load();
  }, [session, status, router, isSuperadmin, load]);

  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => { setError(null); setSuccess(null); }, 6000);
    return () => clearTimeout(t);
  }, [error, success]);

  const testEngine = async (engine: Engine) => {
    setRowTest((prev) => ({ ...prev, [engine.id]: null }));
    try {
      const res = await fetch(`/api/admin/engines/${engine.id}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await json(res);
      setRowTest((prev) => ({ ...prev, [engine.id]: { ok: data.ok, detail: data.detail } }));
    } catch {
      setRowTest((prev) => ({ ...prev, [engine.id]: { ok: false, detail: t("testFailed") } }));
    }
  };

  const testTenant = async (tenant: Tenant) => {
    setRowTest((prev) => ({ ...prev, [`t-${tenant.id}`]: null }));
    try {
      const res = await fetch(`/api/admin/clusters/${tenant.id}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await json(res);
      setRowTest((prev) => ({ ...prev, [`t-${tenant.id}`]: { ok: data.ok, detail: data.detail } }));
    } catch {
      setRowTest((prev) => ({ ...prev, [`t-${tenant.id}`]: { ok: false, detail: t("testFailed") } }));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500" style={{ background: "var(--bg)" }}>
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-6xl p-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1 font-semibold text-gray-800" style={{ fontSize: "13px" }}>
              <button
                onClick={() => router.push("/")}
                className="flex shrink-0 items-center gap-1 hover:text-blue-600"
                title={t("home")}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z"/>
                  <path d="M6 14.5V9h4v5.5"/>
                </svg>
                OLVM-PORTAL
              </button>
              <span className="shrink-0 text-gray-400">/</span>
              <span className="truncate text-gray-700">{t("settings")}</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{t("connectionsTitle")}</h1>
            <p className="text-xs text-gray-500">{t("connectionsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/admin/email")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              {t("emailConfigNav")}
            </button>
            <button
              onClick={() => router.push("/admin/users")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              {t("users")}
            </button>
            <button
              onClick={() => router.push("/admin/backups")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              {t("backups")}
            </button>
            <button
              onClick={() => router.push("/admin/branding")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              {t("branding")}
            </button>
            <LanguageSelector />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>
        )}

        {/* ── ENGINES ── */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">{t("enginesTitle")}</h2>
              <p className="text-[11px] text-gray-400">{t("enginesSubtitle")}</p>
            </div>
            <button
              onClick={() => setEngineModal({ type: "create" })}
              className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8]"
            >
              {t("newEngine")}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-gray-500" style={{ borderColor: "var(--border)" }}>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("name")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">URL</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("auth")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {engines.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                    {t("noEngines")}
                  </td></tr>
                )}
                {engines.map((e) => (
                  <tr key={e.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-900">{e.name}</div>
                      <div className="text-[11px] text-gray-400">{e.id}</div>
                      {rowTest[e.id] && (
                        <div className={`mt-1 text-[11px] ${rowTest[e.id]!.ok ? "text-emerald-600" : "text-red-600"}`}>
                          {rowTest[e.id]!.ok ? "✓" : "✕"} {rowTest[e.id]!.detail}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{e.baseUrl}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                        {e.authMethod === "token" ? "Token" : t("usernameAuth")}
                      </span>
                      {e.allowInsecure && <span className="ml-1 text-[11px] text-amber-600">insecure</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => testEngine(e)} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("test")}</button>
                        <button onClick={() => setEngineModal({ type: "edit", engine: e })} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("edit")}</button>
                        <button onClick={() => setEngineModal({ type: "delete", engine: e })} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100">{t("delete")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── TENANTS ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">{t("tenants")}</h2>
              <p className="text-[11px] text-gray-400">{t("tenantsSubtitle")}</p>
            </div>
            <button
              onClick={() => setTenantModal({ type: "create" })}
              className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8]"
              disabled={engines.length === 0}
              title={engines.length === 0 ? t("createEngineFirst") : undefined}
            >
              {t("newTenant")}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-gray-500" style={{ borderColor: "var(--border)" }}>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("name")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Engine</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Tag</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                    {t("noTenantsConfigured")}
                  </td></tr>
                )}
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-900">{tenant.name}</div>
                      <div className="text-[11px] text-gray-400">{tenant.id}</div>
                      {rowTest[`t-${tenant.id}`] && (
                        <div className={`mt-1 text-[11px] ${rowTest[`t-${tenant.id}`]!.ok ? "text-emerald-600" : "text-red-600"}`}>
                          {rowTest[`t-${tenant.id}`]!.ok ? "✓" : "✕"} {rowTest[`t-${tenant.id}`]!.detail}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-gray-700">{tenant.engineName}</div>
                      <div className="text-[11px] text-gray-400">{tenant.engineUrl}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {tenant.tag ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{tenant.tag}</span>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => testTenant(tenant)} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("test")}</button>
                        <button onClick={() => setTenantModal({ type: "edit", tenant })} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("edit")}</button>
                        <button onClick={() => setTenantModal({ type: "delete", tenant })} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100">{t("delete")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Engine modals */}
      {engineModal.type === "create" && (
        <EngineForm
          onClose={() => setEngineModal({ type: "closed" })}
          onSaved={async (msg) => { setSuccess(msg); setEngineModal({ type: "closed" }); await load(); }}
          onError={setError}
        />
      )}
      {engineModal.type === "edit" && (
        <EngineForm
          engine={engineModal.engine}
          onClose={() => setEngineModal({ type: "closed" })}
          onSaved={async (msg) => { setSuccess(msg); setEngineModal({ type: "closed" }); await load(); }}
          onError={setError}
        />
      )}
      {engineModal.type === "delete" && (
        <ConfirmDelete
          title={t("deleteEngineTitle")}
          name={engineModal.engine.name}
          id={engineModal.engine.id}
          description={t("deleteEngineDescription")}
          onClose={() => setEngineModal({ type: "closed" })}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/admin/engines/${engineModal.engine.id}`, { method: "DELETE" });
              const data = await json(res);
              if (!res.ok) throw new Error(data?.error || t("deleteError"));
              setSuccess(t("engineDeleted")); setEngineModal({ type: "closed" }); await load();
            } catch (err) { setError((err as Error).message); }
          }}
        />
      )}

      {/* Tenant modals */}
      {tenantModal.type === "create" && (
        <TenantForm
          engines={engines}
          onClose={() => setTenantModal({ type: "closed" })}
          onSaved={async (msg) => { setSuccess(msg); setTenantModal({ type: "closed" }); await load(); }}
          onError={setError}
        />
      )}
      {tenantModal.type === "edit" && (
        <TenantForm
          tenant={tenantModal.tenant}
          engines={engines}
          onClose={() => setTenantModal({ type: "closed" })}
          onSaved={async (msg) => { setSuccess(msg); setTenantModal({ type: "closed" }); await load(); }}
          onError={setError}
        />
      )}
      {tenantModal.type === "delete" && (
        <ConfirmDelete
          title={t("deleteTenantTitle")}
          name={tenantModal.tenant.name}
          id={tenantModal.tenant.id}
          description={t("deleteTenantDescription")}
          onClose={() => setTenantModal({ type: "closed" })}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/admin/clusters/${tenantModal.tenant.id}`, { method: "DELETE" });
              const data = await json(res);
              if (!res.ok) throw new Error(data?.error || t("deleteError"));
              setSuccess(t("tenantDeleted")); setTenantModal({ type: "closed" }); await load();
            } catch (err) { setError((err as Error).message); }
          }}
        />
      )}
    </div>
  );
}

/* ── Engine Form ──────────────────────────────────────────────────────── */

function EngineForm({
  engine,
  onClose,
  onSaved,
  onError,
}: {
  engine?: Engine;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations(adminMessages);
  const editing = Boolean(engine);
  const [name, setName] = useState(engine?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(engine?.baseUrl ?? "");
  const [allowInsecure, setAllowInsecure] = useState(engine?.allowInsecure ?? true);
  const [authMethod, setAuthMethod] = useState<"basic" | "token">(engine?.authMethod ?? "basic");
  const [username, setUsername] = useState(engine?.username ?? "admin@internal");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showCa, setShowCa] = useState(Boolean(engine?.hasCa));
  const [caCert, setCaCert] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<TestResult>(null);
  const [saving, setSaving] = useState(false);
  const [sharedSds, setSharedSds] = useState<string[]>(engine?.sharedStorageDomains ?? []);
  const [sharedStorageDomains, setSharedStorageDomains] = useState(engine?.sharedStorageDomains ?? []);
  const [availableSds, setAvailableSds] = useState<{ name: string; availableGB: number }[]>([]);
  const [loadingSds, setLoadingSds] = useState(false);

  useEffect(() => {
    if (!engine) return;
    setLoadingSds(true);
    fetch(`/api/admin/engines/${engine.id}/storage-domains`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAvailableSds(data.map((d: { name: string; availableGB: number }) => ({ name: d.name, availableGB: d.availableGB })));
      })
      .catch(() => {})
      .finally(() => setLoadingSds(false));
  }, [engine]);

  const toggleSharedSd = (name: string) => {
    setSharedSds((prev) => prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = { name, baseUrl, allowInsecure, sharedStorageDomains: sharedSds };
    if (authMethod === "basic") {
      payload.username = username;
      if (password) payload.password = password;
    } else {
      if (token) payload.token = token;
    }
    if (showCa && caCert) payload.caCert = caCert;
    return payload;
  };

  const runTest = async () => {
    setTesting(true); setTestRes(null);
    try {
      const url = editing ? `/api/admin/engines/${engine!.id}/test` : "/api/admin/engines/test";
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()),
      });
      const data = await json(res);
      setTestRes({ ok: data.ok, detail: data.detail });
    } catch { setTestRes({ ok: false, detail: t("testFailed") }); }
    finally { setTesting(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const url = editing ? `/api/admin/engines/${engine!.id}` : "/api/admin/engines";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) });
      const data = await json(res);
      if (!res.ok) throw new Error(data?.error || t("saveError"));
      onSaved(editing ? t("engineUpdated") : t("engineCreated"));
    } catch (err) { onError((err as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-white shadow-xl" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold text-gray-900">{editing ? t("editEngine") : t("newOlvmEngine")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
        </div>

        <form onSubmit={save} className="space-y-3 p-4">
          <label className="block">
            <span className={labelCls}>{t("name")}</span>
            <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("engineNamePlaceholder")} required />
          </label>

          <label className="block">
            <span className={labelCls}>{t("engineUrl")}</span>
            <input className={`${inputCls} mt-1`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://olvm.example.com/ovirt-engine/api" required />
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowInsecure} onChange={(e) => setAllowInsecure(e.target.checked)} className="h-4 w-4" />
            <span className="text-xs text-gray-600">{t("allowSelfSigned")}</span>
          </label>

          <div>
            <span className={labelCls}>{t("authentication")}</span>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="radio" checked={authMethod === "basic"} onChange={() => setAuthMethod("basic")} />
                {t("usernamePassword")}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="radio" checked={authMethod === "token"} onChange={() => setAuthMethod("token")} />
                Token
              </label>
            </div>
          </div>

          {authMethod === "basic" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                 <span className={labelCls}>{t("usernameAuth")}</span>
                <input className={`${inputCls} mt-1`} value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="block">
                 <span className={labelCls}>{t("password")}</span>
                 <input type="password" className={`${inputCls} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? t("blankKeepsCurrent") : ""} required={!editing} />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className={labelCls}>Token (Bearer)</span>
               <textarea className={`${inputCls} mt-1 font-mono`} rows={2} value={token} onChange={(e) => setToken(e.target.value)} placeholder={editing ? t("blankKeepsCurrent") : "OAuth2 token"} required={!editing} />
            </label>
          )}



          {editing && (
            <div>
              <span className={labelCls}>{t("sharedStorageDomains")}</span>
              <p className="mt-0.5 text-[10px] text-gray-400">{t("sharedStorageExample")}</p>
              {loadingSds ? (
                <p className="mt-1 text-[11px] text-gray-400">{t("loadingStorageDomains")}</p>
              ) : availableSds.length === 0 ? (
                <p className="mt-1 text-[11px] text-gray-400">{t("noStorageDomains")}</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {availableSds.map((sd) => (
                    <label key={sd.name} className="flex items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-gray-50" style={{ borderColor: "var(--border)" }}>
                      <input type="checkbox" checked={sharedSds.includes(sd.name)} onChange={() => toggleSharedSd(sd.name)} className="h-4 w-4" />
                      <span className="text-xs text-gray-700">{sd.name}</span>
                      <span className="ml-auto text-[10px] text-gray-400">{t("gbFree", { value: sd.availableGB.toFixed(0) })}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <button type="button" onClick={() => setShowCa((s) => !s)} className="text-[11px] text-blue-600 hover:underline">
              {showCa ? t("hideCa") : t("optionalCa")}
            </button>
            {showCa && (
              <textarea className={`${inputCls} mt-1 font-mono`} rows={3} value={caCert} onChange={(e) => setCaCert(e.target.value)} placeholder={t("caPlaceholder")} />
            )}
          </div>

          {testRes && (
            <div className={`rounded-md border px-3 py-2 text-xs ${testRes.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
              {testRes.ok ? "✓" : "✕"} {testRes.detail}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <button type="button" onClick={runTest} disabled={testing} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {testing ? t("testing") : t("testConnection")}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("cancel")}</button>
              <button type="submit" disabled={saving} className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                 {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Tenant Form ──────────────────────────────────────────────────────── */

function TenantForm({
  tenant,
  engines,
  onClose,
  onSaved,
  onError,
}: {
  tenant?: Tenant;
  engines: Engine[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations(adminMessages);
  const editing = Boolean(tenant);
  const [id, setId] = useState(tenant?.id ?? "");
  const [name, setName] = useState(tenant?.name ?? "");
  const [engineId, setEngineId] = useState(tenant?.engineId ?? engines[0]?.id ?? "");
  const [tag, setTag] = useState(tenant?.tag ?? "");
  const [selectedSds, setSelectedSds] = useState<string[]>(tenant?.storageDomains ?? []);
  const [availableSds, setAvailableSds] = useState<{ name: string; availableGB: number }[]>([]);
  const [loadingSds, setLoadingSds] = useState(false);
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>(tenant?.networks ?? []);
  const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);
  const [loadingNetworks, setLoadingNetworks] = useState(false);
  const [networkPrefixes, setNetworkPrefixes] = useState<Record<string, { prefix: string; mask: string }>>(
    Object.fromEntries((tenant?.networkConfig ?? []).map((n) => [n.name, { prefix: n.prefix, mask: n.mask }]))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!engineId) { setAvailableSds([]); setAvailableNetworks([]); return; }
    setLoadingSds(true);
    fetch(`/api/admin/engines/${engineId}/storage-domains`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setAvailableSds(data.map((sd: { name: string; availableGB: number }) => ({ name: sd.name, availableGB: sd.availableGB }))))
      .catch(() => setAvailableSds([]))
      .finally(() => setLoadingSds(false));
    setLoadingNetworks(true);
    fetch(`/api/admin/engines/${engineId}/networks`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setAvailableNetworks(Array.isArray(data) ? data.map((n: string) => n) : []))
      .catch(() => setAvailableNetworks([]))
      .finally(() => setLoadingNetworks(false));
  }, [engineId]);

  const toggleSd = (sdName: string) => {
    setSelectedSds((prev) =>
      prev.includes(sdName) ? prev.filter((s) => s !== sdName) : [...prev, sdName],
    );
  };

  const toggleNetwork = (netName: string) => {
    setSelectedNetworks((prev) => {
      const next = prev.includes(netName) ? prev.filter((s) => s !== netName) : [...prev, netName];
      setNetworkPrefixes((pp) => {
        if (next.includes(netName) && !pp[netName]) {
          return { ...pp, [netName]: { prefix: "", mask: "" } };
        }
        return pp;
      });
      return next;
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const nc = selectedNetworks
        .map((name) => ({ name, prefix: networkPrefixes[name]?.prefix ?? "", mask: networkPrefixes[name]?.mask ?? "" }))
        .filter((n) => n.prefix || n.mask);
      const payload: Record<string, unknown> = { name, engineId, tag, storageDomains: selectedSds, networks: selectedNetworks, networkConfig: nc.length > 0 ? nc : undefined };
      if (!editing) payload.id = id;
      const url = editing ? `/api/admin/clusters/${tenant!.id}` : "/api/admin/clusters";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await json(res);
      if (!res.ok) throw new Error(data?.error || t("saveError"));
      onSaved(editing ? t("tenantUpdated") : t("tenantCreated"));
    } catch (err) { onError((err as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white shadow-xl" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold text-gray-900">{editing ? t("editTenant") : t("newTenant").replace("+ ", "")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
        </div>

        <form onSubmit={save} className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>{t("name")}</span>
              <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tenant A" required />
            </label>
            {!editing && (
              <label className="block">
                <span className={labelCls}>ID (tenant)</span>
                <input className={`${inputCls} mt-1`} value={id} onChange={(e) => setId(e.target.value)} placeholder="tenant-a" required />
              </label>
            )}
          </div>

          <label className="block">
            <span className={labelCls}>Engine OLVM</span>
            <select className={`${inputCls} mt-1`} value={engineId} onChange={(e) => setEngineId(e.target.value)} required>
               {engines.length === 0 && <option value="">{t("noEnginesAvailable")}</option>}
              {engines.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.baseUrl})</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelCls}>Tag (multitenant)</span>
            <input className={`${inputCls} mt-1`} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tenant-a" required />
          </label>

          <div>
            <span className={labelCls}>{t("assignedStorageDomains")}</span>
            <p className="mt-0.5 text-[10px] text-gray-400">{t("allStorageIfNone")}</p>
            {loadingSds ? (
              <p className="mt-1 text-[11px] text-gray-400">{t("loadingStorageDomains")}</p>
            ) : availableSds.length === 0 ? (
              <p className="mt-1 text-[11px] text-gray-400">{t("noStorageDomains")}</p>
            ) : (
              <div className="mt-1 space-y-1">
                {availableSds.map((sd) => (
                  <label key={sd.name} className="flex items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-gray-50" style={{ borderColor: "var(--border)" }}>
                    <input
                      type="checkbox"
                      checked={selectedSds.includes(sd.name)}
                      onChange={() => toggleSd(sd.name)}
                      className="h-4 w-4"
                    />
                    <span className="text-xs text-gray-700">{sd.name}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{t("gbFree", { value: sd.availableGB.toFixed(0) })}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className={labelCls}>{t("assignedNetworks")}</span>
            <p className="mt-0.5 text-[10px] text-gray-400">{t("allNetworksIfNone")}</p>
            {loadingNetworks ? (
              <p className="mt-1 text-[11px] text-gray-400">{t("loadingNetworks")}</p>
            ) : availableNetworks.length === 0 ? (
              <p className="mt-1 text-[11px] text-gray-400">{t("noNetworks")}</p>
            ) : (
              <div className="mt-1 space-y-1">
                {availableNetworks.map((netName) => (
                  <div key={netName} className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                    <label className="flex items-center gap-2 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedNetworks.includes(netName)}
                        onChange={() => toggleNetwork(netName)}
                        className="h-4 w-4"
                      />
                      <span className="text-xs font-medium text-gray-700">{netName}</span>
                    </label>
                    {selectedNetworks.includes(netName) && (
                      <div className="mt-1 flex gap-2 pl-6">
                        <input
                          type="text"
                          value={networkPrefixes[netName]?.prefix ?? ""}
                          onChange={(e) => setNetworkPrefixes((pp) => ({ ...pp, [netName]: { prefix: e.target.value, mask: pp[netName]?.mask ?? "" } }))}
                          placeholder="192.168.1"
                          className="w-24 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-400"
                        />
                        <input
                          type="text"
                          value={networkPrefixes[netName]?.mask ?? ""}
                          onChange={(e) => setNetworkPrefixes((pp) => ({ ...pp, [netName]: { prefix: pp[netName]?.prefix ?? "", mask: e.target.value } }))}
                          placeholder="255.255.255.0"
                          className="w-28 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-400"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <button type="button" onClick={onClose} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("cancel")}</button>
            <button type="submit" disabled={saving || (!editing && engines.length === 0)} className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Confirm Delete ───────────────────────────────────────────────────── */

function ConfirmDelete({
  title, name, id, description, onClose, onConfirm,
}: {
  title: string; name: string; id: string; description: string;
  onClose: () => void; onConfirm: () => void;
}) {
  const t = useTranslations(adminMessages);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">
          {t("deleteQuestion", { name, id, description })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">{t("cancel")}</button>
          <button onClick={onConfirm} className="rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-700">{t("delete")}</button>
        </div>
      </div>
    </div>
  );
}
