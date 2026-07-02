"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { SixmanagerMark } from "@/components/SixmanagerMark";

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
  const [step, setStep] = useState<1 | 2>(1);
  const [maskedEmail, setMaskedEmail] = useState("");

  const completeLogin = async (code?: string) => {
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      ...(code ? { code } : {}),
      callbackUrl: safeCallbackPath,
    });

    setLoading(false);
    if (result?.error) {
      setError(code ? "Código incorrecto o expirado" : "Credenciales inválidas");
      return;
    }
    let target = safeCallbackPath;
    if (result?.url) {
      try {
        const parsed = new URL(result.url, window.location.origin);
        if (parsed.origin === window.location.origin) {
          target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // ignore malformed URL and keep safe callback
      }
    }
    router.push(target);
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
        setError(data?.error || "No se pudo enviar el código");
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
          ? "Se envió un código a tu correo (modo prueba: revisa la consola del servidor si no llega)."
          : "Se envió un código a tu correo.",
      );
    } catch {
      setError("No se pudo contactar con el servidor");
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

  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center justify-center rounded-xl border bg-white p-3 shadow-sm" style={{ borderColor: "var(--border)" }}>
            <SixmanagerMark subtitle="OLVM Portal" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            {step === 1 ? "Ingresar al portal" : "Verificación en dos pasos"}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {step === 1
              ? "Accede con tus credenciales de tenant."
              : `Ingresa el código de 6 dígitos enviado a ${maskedEmail}.`}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: "var(--border)" }}>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {info}
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={requestChallenge} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Correo electrónico
                </label>
                <input
                  type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="admin@empresa.com"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Contraseña
                </label>
                <input
                  type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="mt-1 w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "Enviando código..." : "Continuar"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyAndSignIn} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Código de verificación
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
                {loading ? "Verificando..." : "Verificar e ingresar"}
              </button>
              <button
                type="button" onClick={requestChallenge} disabled={loading}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                Reenviar código
              </button>
              <button
                type="button" onClick={backToCredentials}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
              >
                ← Volver
              </button>
            </form>
          )}
        </div>

        {step === 1 && (
          <p className="mt-3 text-center text-xs text-gray-500">
            ¿Sin cuenta?{" "}
            <Link href="/register" className="font-semibold text-blue-600 hover:text-blue-700">
              Crear usuario
            </Link>
          </p>
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
