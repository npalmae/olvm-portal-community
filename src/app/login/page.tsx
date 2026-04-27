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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl: safeCallbackPath,
    });

    setLoading(false);
    if (result?.error) {
      setError("Credenciales inválidas");
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

  return (
    <main className="min-h-screen bg-[#05070c] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b1321]/80 p-8 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mb-6 space-y-2 text-center">
          <SixmanagerMark
            align="center"
            subtitle="OLVM Portal"
          />
          <h1 className="text-2xl font-semibold text-white">Ingresa a tu cuenta</h1>
          <p className="text-sm text-white/60">
            Accede con tus credenciales asignadas a un tenant.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/60">
          ¿No tienes cuenta?{" "}
          <Link
            href="/register"
            className="font-semibold text-[#3ad4ad] hover:text-[#7ce3ff]"
          >
            Crear usuario
          </Link>
        </p>
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
