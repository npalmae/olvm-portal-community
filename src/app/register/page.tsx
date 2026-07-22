"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { SixmanagerMark } from "@/components/SixmanagerMark";
import { usePortalBranding } from "@/components/usePortalBranding";

export default function RegisterPage() {
  const router = useRouter();
  const { branding } = usePortalBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("default");
  const [role, setRole] = useState("user");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, tenantId, role }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data?.error || "No se pudo crear el usuario");
      return;
    }

    setSuccess("Usuario creado. Iniciando sesión…");
    await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl: "/",
    });
    router.push("/");
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-xl">
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
          <h1 className="text-lg font-bold text-gray-900">Crear cuenta</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Registra un usuario asociado a un tenant existente.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: "var(--border)" }}>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Nombre
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                placeholder="Jane Doe"
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Correo electrónico
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                placeholder="admin@empresa.com"
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                placeholder="••••••••"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Tenant ID
                <input
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2 placeholder-gray-400"
                  placeholder="default"
                />
              </label>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Rol
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none ring-blue-500/30 focus:border-blue-400 focus:ring-2"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-gray-500">
              El rol <span className="font-semibold text-amber-700">superadmin</span> puede gestionar todos los tenants. Úsalo solo si necesitas control global.
            </p>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Creando usuario…" : "Registrar"}
            </button>
          </form>
        </div>

        <p className="mt-3 text-center text-xs text-gray-500">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
