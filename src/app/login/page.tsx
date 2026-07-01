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
    <main className="min-h-screen bg-[#05070c] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b1321]/80 p-8 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mb-6 space-y-2 text-center">
          <SixmanagerMark
            align="center"
            subtitle="OLVM Portal"
          />
          <h1 className="text-2xl font-semibold text-white">
            {step === 1 ? "Ingresa a tu cuenta" : "Verificación en dos pasos"}
          </h1>
          <p className="text-sm text-white/60">
            {step === 1
              ? "Accede con tus credenciales asignadas a un tenant."
              : `Ingresa el código de 6 dígitos enviado a ${maskedEmail}.`}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {info}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={requestChallenge} className="space-y-4">
            <label className="block text-sm text-white/70">
              Correo electrónico
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                placeholder="admin@empresa.com"
              />
            </label>
            <label className="block text-sm text-white/70">
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                placeholder="••••••••"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#3ad4ad]/50 bg-[#3ad4ad]/20 px-4 py-3 text-sm font-semibold text-[#3ad4ad] transition hover:-translate-y-0.5 hover:bg-[#3ad4ad]/30 disabled:opacity-60"
            >
              {loading ? "Enviando código…" : "Continuar"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyAndSignIn} className="space-y-4">
            <label className="block text-sm text-white/70">
              Código de verificación
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                autoFocus
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-center text-lg tracking-[0.5em] text-white outline-none ring-emerald-400/30 focus:ring"
                placeholder="000000"
              />
            </label>
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#3ad4ad]/50 bg-[#3ad4ad]/20 px-4 py-3 text-sm font-semibold text-[#3ad4ad] transition hover:-translate-y-0.5 hover:bg-[#3ad4ad]/30 disabled:opacity-60"
            >
              {loading ? "Verificando…" : "Verificar e ingresar"}
            </button>
            <button
              type="button"
              onClick={requestChallenge}
              disabled={loading}
              className="w-full text-center text-xs text-white/55 hover:text-white disabled:opacity-50"
            >
              Reenviar código
            </button>
            <button
              type="button"
              onClick={backToCredentials}
              className="w-full text-center text-xs text-white/45 hover:text-white/70"
            >
              ← Volver
            </button>
          </form>
        )}

        {step === 1 && (
          <p className="mt-6 text-center text-sm text-white/60">
            ¿No tienes cuenta?{" "}
            <Link
              href="/register"
              className="font-semibold text-[#3ad4ad] hover:text-[#7ce3ff]"
            >
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
