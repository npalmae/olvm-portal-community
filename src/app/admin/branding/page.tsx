"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SixmanagerMark } from "@/components/SixmanagerMark";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import { adminMessages } from "@/i18n/admin";

type BrandingState = {
  brandName: string;
  hasLogo: boolean;
  logoMime: string;
  logoWidth: number;
  logoHeight: number;
  logoSize: number;
  maxBytes: number;
};

const ALLOWED_EXT = ["png", "jpg", "jpeg", "webp", "gif"];

const getExt = (name: string) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

export default function AdminBrandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations(adminMessages);
  const { locale } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<BrandingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/branding");
      if (!res.ok) throw new Error(t("unauthorized"));
      const data = await res.json();
      setState(data);
      setBrandName(data.brandName ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || !isSuperadmin) {
      router.push("/");
      return;
    }
    load();
  }, [session, status, isSuperadmin, router, load]);

  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [error, success]);

  const onSelectFile = (file: File | null) => {
    setError(null);
    setSelectedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const ext = getExt(file.name);
    if (!ALLOWED_EXT.includes(ext)) {
      setError(t("extensionNotAllowed", { ext, allowed: ALLOWED_EXT.join(", ") }));
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    if (state && file.size > state.maxBytes) {
      setError(t("fileTooLarge", { max: Math.round(state.maxBytes / 1024 / 1024) }));
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData();
      fd.append("brandName", brandName);
      if (selectedFile) fd.append("logo", selectedFile);

      const res = await fetch("/api/admin/branding", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t("brandingSaveError"));

      setSuccess(t("brandingUpdated"));
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(t("removeBrandingConfirm"))) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/branding", { method: "DELETE" });
      if (!res.ok) throw new Error(t("brandingDeleteError"));
      setSuccess(t("brandingDeleted"));
      setBrandName("");
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] text-gray-700 dark:text-gray-300 flex items-center justify-center">
        <p>{t("loading")}</p>
      </div>
    );
  }

  const currentLogoUrl = state?.hasLogo ? `/api/branding/logo?t=${Date.now()}` : null;
  const showPreview = previewUrl || currentLogoUrl;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1 font-semibold text-gray-800 dark:text-gray-200" style={{ fontSize: "13px" }}>
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
              <span className="truncate text-gray-700 dark:text-gray-300">{t("branding")}</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("brandingTitle")}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("brandingSubtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/admin/email")}
              className="rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#171326] px-2.5 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:bg-[#12101a] dark:hover:bg-white/5"
            >
              {t("email")}
            </button>
            <button
              onClick={() => router.push("/admin/backups")}
              className="rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#171326] px-2.5 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:bg-[#12101a] dark:hover:bg-white/5"
            >
              {t("backups")}
            </button>
            <button
              onClick={() => router.push("/admin/clusters")}
              className="rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#171326] px-2.5 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:bg-[#12101a] dark:hover:bg-white/5"
            >
              {t("clusters")}
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

        <div className="space-y-6">
          {/* Preview */}
          <div className="bg-white dark:bg-[#171326] rounded-lg border p-6" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">{t("preview")}</h2>
            <div className="flex flex-col items-center gap-3 py-6 rounded-lg" style={{ background: "var(--bg)" }}>
              <div className="inline-flex items-center justify-center rounded-xl border bg-white dark:bg-[#171326] p-3 shadow-sm" style={{ borderColor: "var(--border)" }}>
                {showPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl ?? currentLogoUrl ?? ""}
                    alt={t("previewAlt")}
                    className="h-auto w-[130px] sm:w-[160px] object-contain"
                  />
                ) : (
                  <SixmanagerMark subtitle="Virtual Portal" />
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {brandName || "Virtual Portal"}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white dark:bg-[#171326] rounded-lg border p-6 space-y-4" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("settings")}</h2>

            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{t("brandName")}</span>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                maxLength={80}
                placeholder={t("brandPlaceholder")}
                className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30"
              />
              <span className="block mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t("brandNameHelp")}
              </span>
            </label>

            <div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Logo</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif"
                onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-gray-500 dark:text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-violet-50 dark:bg-violet-500/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-violet-700 dark:text-violet-300 hover:file:bg-violet-100"
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t("logoRules", { max: state ? Math.round(state.maxBytes / 1024 / 1024) : 2 })}
              </p>
              {state?.hasLogo && !selectedFile && (
                <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {t("currentLogo", { width: state.logoWidth, height: state.logoHeight, size: (state.logoSize / 1024).toFixed(1), mime: state.logoMime })}
                </p>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={remove}
                disabled={saving || !state?.hasLogo}
                className="px-4 py-2 text-sm bg-red-50 dark:bg-red-500/10 hover:bg-red-100 text-red-700 dark:text-red-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("removeBranding")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || (!selectedFile && brandName === (state?.brandName ?? ""))}
                className="px-6 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg disabled:opacity-50"
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 p-4 text-xs text-violet-800">
            <p className="font-semibold mb-1">{t("validations")}</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>{t("validationExtensions")}</li>
              <li>{t("validationMagicBytes")}</li>
              <li>{t("validationMaxSize", { max: state ? Math.round(state.maxBytes / 1024 / 1024) : 2 })}</li>
              <li>{t("validationReencode")}</li>
              <li>{t("validationServerName")}</li>
              <li>{t("validationHeaders")}</li>
              <li>{t("validationSuperadmin")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
