"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import { adminMessages } from "@/i18n/admin";

type EmailConfig = {
  provider: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  fromAddress: string;
  enabled: boolean;
};

export default function EmailConfigPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations(adminMessages);
  const { locale } = useLocale();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || !isSuperadmin) {
      router.push("/");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/admin/email");
        if (!res.ok) throw new Error(t("unauthorized"));
        const data = await res.json();
        setConfig(data);
        setFromAddress(data.fromAddress ?? "");
        setEnabled(data.enabled ?? true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [session, status, isSuperadmin, router]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          fromAddress,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setConfig(data);
      setApiKey("");
      setSuccess(t("configurationSaved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [apiKey, fromAddress, enabled, locale]);

  const sendTest = useCallback(async () => {
    if (!testEmail) { setError(t("testEmailRequired")); return; }
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? t("genericError"));
      setSuccess(t("testEmailSent", { email: testEmail }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }, [testEmail, locale]);

  if (loading) return <div className="p-8 text-sm text-gray-500 dark:text-gray-400">{t("loading")}</div>;
  if (!isSuperadmin) return null;

  return (
    <div className="min-h-screen p-8" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
          <div className="mb-2 flex items-center gap-1 font-semibold text-gray-800 dark:text-gray-200" style={{ fontSize: "13px" }}>
            <button
              onClick={() => router.push("/")}
              className="flex shrink-0 items-center gap-1 hover:text-violet-600 dark:text-violet-400"
              title={t("home")}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z"/>
                <path d="M6 14.5V9h4v5.5"/>
              </svg>
              VIRTUAL-PORTAL
            </button>
            <span className="shrink-0 text-gray-400 dark:text-gray-500">/</span>
            <button
              onClick={() => router.push("/admin/clusters")}
              className="shrink-0 text-gray-600 dark:text-gray-400 hover:text-violet-600 dark:text-violet-400"
            >
              {t("settings")}
            </button>
            <span className="shrink-0 text-gray-400 dark:text-gray-500">/</span>
            <span className="truncate text-gray-700 dark:text-gray-300">{t("email")}</span>
          </div>
          <h1 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">{t("emailTitle")}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("emailSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/admin/backups")}
              className="rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#171326] px-2.5 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:bg-[#12101a] dark:hover:bg-white/5"
            >
              {t("backups")}
            </button>
            <LanguageSelector />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{success}</div>
        )}

        <div className="space-y-4 rounded-lg border bg-white dark:bg-[#171326] p-6" style={{ borderColor: "var(--border)" }}>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("provider")}</label>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#12101a] px-3 py-2 text-sm text-gray-700 dark:text-gray-300">Resend</span>
              {config?.hasApiKey ? (
                <span className="rounded-md bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">API Key: {config.apiKeyHint}</span>
              ) : (
                <span className="rounded-md bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">{t("noApiKey")}</span>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              API Key de Resend
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
               placeholder={config?.hasApiKey ? t("currentKeep", { value: config.apiKeyHint }) : "re_xxxxxxxxxxxx"}
              className="w-full rounded-md border border-gray-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30"
            />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{t("getApiKey")} <a href="https://resend.com/api-keys" target="_blank" rel="noopener" className="text-violet-500 hover:underline">resend.com/api-keys</a></p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("senderEmail")}
            </label>
            <input
              type="email"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="noreply@tudominio.com"
              className="w-full rounded-md border border-gray-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30"
            />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{t("verifiedDomain")}</p>
          </div>

          <label className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("emailEnabled")}</span>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{t("emailDisabledHelp")}</p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-5 w-5"
            />
          </label>

          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-md bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? t("saving") : t("saveConfiguration")}
          </button>
        </div>

        <div className="mt-6 rounded-lg border bg-white dark:bg-[#171326] p-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t("sendTestEmail")}</h2>
          <div className="flex gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="destino@ejemplo.com"
              className="flex-1 rounded-md border border-gray-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30"
            />
            <button
              onClick={sendTest}
              disabled={testing}
              className="rounded-md border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 disabled:opacity-60"
            >
              {testing ? t("sending") : t("test")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
