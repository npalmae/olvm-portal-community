"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SixmanagerMark } from "@/components/SixmanagerMark";
import { usePortalBranding } from "@/components/usePortalBranding";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslations } from "@/components/LocaleProvider";
import { authMessages } from "@/i18n/auth";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const { branding } = usePortalBranding();
  const t = useTranslations(authMessages);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const mismatch = password.length > 0 && password !== confirm;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("reset.tooShort");
      return;
    }
    if (mismatch) {
      setError("reset.mismatch");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "reset.error");
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-end"><LanguageSelector /></div>
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center justify-center rounded-xl border bg-white p-3 shadow-sm" style={{ borderColor: "var(--border)" }}>
            {branding.hasLogo && branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt={branding.brandName} className="h-auto w-[130px] sm:w-[160px] object-contain" />
            ) : (
              <SixmanagerMark subtitle="OLVM Portal" />
            )}
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t("reset.title")}</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {success ? t("reset.updated") : t("reset.description")}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: "var(--border)" }}>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error in authMessages ? t(error) : error}
            </div>
          )}
          {success ? (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {t("reset.success")}
            </div>
          ) : !token ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("reset.invalidToken")}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {t("reset.newPassword")}
                </label>
                <input
                  type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {t("reset.confirmPassword")}
                </label>
                <input
                  type="password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className={`w-full rounded-md border px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:ring-2 placeholder-gray-400 ${
                    mismatch ? "border-red-400" : "border-gray-200 focus:border-blue-400"
                  }`}
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit" disabled={loading || mismatch}
                className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? t("reset.saving") : t("reset.submit")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-gray-500">
          <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">{t("common.backToLogin")}</Link>
        </p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
