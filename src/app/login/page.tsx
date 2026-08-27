"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { SixmanagerMark } from "@/components/SixmanagerMark";
import { usePortalBranding } from "@/components/usePortalBranding";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslations } from "@/components/LocaleProvider";
import { authMessages } from "@/i18n/auth";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const safeCallbackPath = callbackUrl.startsWith("/") ? callbackUrl : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2 | "forgot">(1);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const { branding } = usePortalBranding();
  const t = useTranslations(authMessages);

  const reason = searchParams.get("reason");
  useEffect(() => {
    if (reason === "inactivity") setInfo("login.inactivity");
    else if (reason === "expired") setInfo("login.expired");
  }, [reason]);

  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (data.setupComplete === false) router.push("/setup"); })
      .catch(() => {});
  }, [router]);

  const completeLogin = async (code?: string) => {
    const result = await signIn("credentials", {
      redirect: true,
      callbackUrl: "/",
      email,
      password,
      ...(code ? { code } : {}),
    });
  };

  const requestChallenge = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "login.challengeError");
        return;
      }
      // 2FA desactivado para este usuario: login directo sin código
      if (data?.challenge === false) {
        await completeLogin();
        return;
      }
      setMaskedEmail(data?.maskedEmail || email);
      setStep(2);
      setInfo(
        data?.fallback
          ? "login.codeSentFallback"
          : "login.codeSent",
      );
    } catch {
      setError("login.serverError");
    } finally {
      setLoading(false);
    }
  };

  const verifyAndSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    await completeLogin(code);
  };

  const backToCredentials = () => {
    setStep(1);
    setCode("");
    setError(null);
    setInfo(null);
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "login.resetRequestError");
      setForgotSent(true);
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
        {/* Logo */}
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center justify-center rounded-xl border bg-white p-3 shadow-sm" style={{ borderColor: "var(--border)" }}>
            {branding.hasLogo && branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={branding.brandName}
                width={branding.logoWidth || 160}
                height={branding.logoHeight || 107}
                className="h-auto w-[130px] sm:w-[160px] object-contain"
              />
            ) : (
              <SixmanagerMark subtitle="OLVM Portal" />
            )}
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            {step === "forgot"
              ? t("login.forgotTitle")
              : step === 1
                ? t("login.title", { brand: branding.brandName })
                : t("login.twoFactorTitle")}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {step === "forgot"
              ? t("login.forgotDescription")
              : step === 1
                ? t("login.description")
                : t("login.codeDescription", { email: maskedEmail })}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: "var(--border)" }}>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error in authMessages ? t(error) : error}
            </div>
          )}
          {info && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {info in authMessages ? t(info) : info}
            </div>
          )}

          {step === "forgot" ? (
            forgotSent ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
                {t("login.forgotSuccess")}
              </div>
            ) : (
              <form onSubmit={submitForgot} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    {t("common.email")}
                  </label>
                  <input
                    type="email" value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required autoFocus
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                    placeholder={t("common.emailPlaceholder")}
                  />
                </div>
                <button
                  type="submit" disabled={loading}
                  className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {loading ? t("login.sending") : t("login.sendRecoveryLink")}
                </button>
              </form>
            )
          ) : step === 1 ? (
            <form onSubmit={requestChallenge} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {t("common.email")}
                </label>
                <input
                  type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder={t("common.emailPlaceholder")}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {t("common.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-200 px-3 py-2 pr-10 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
                </div>
              </div>
              <button
                type="submit" disabled={loading}
                className="mt-1 w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? t("login.sendingCode") : t("login.continue")}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyAndSignIn} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {t("login.verificationCode")}
                </label>
                <input
                  type="text" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required autoFocus
                  className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-center text-lg tracking-[0.5em] text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit" disabled={loading || code.length !== 6}
                className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? t("login.verifying") : t("login.verifyAndSignIn")}
              </button>
              <button
                type="button" onClick={requestChallenge} disabled={loading}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                {t("login.resendCode")}
              </button>
              <button
                type="button" onClick={backToCredentials}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
              >
                {t("login.back")}
              </button>
            </form>
          )}
        </div>

        {(step === 1 || step === "forgot") && (
          <div className="mt-3 text-center text-xs text-gray-500 space-y-1">
            {step === 1 && (
              <>
                <p>
                  {t("login.noAccount")}{" "}
                  <Link href="/register" className="font-semibold text-blue-600 hover:text-blue-700">
                    {t("login.createUser")}
                  </Link>
                </p>
                <p>
                  <button onClick={() => { setStep("forgot"); setForgotSent(false); setError(null); setForgotEmail(email); }} className="text-gray-400 hover:text-blue-600">
                    {t("login.forgotPassword")}
                  </button>
                </p>
              </>
            )}
            {step === "forgot" && (
              <button onClick={() => setStep(1)} className="text-gray-400 hover:text-blue-600">
                {t("common.backToLogin")}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
