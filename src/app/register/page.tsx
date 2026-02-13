"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const router = useRouter();
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
    <main className="min-h-screen bg-[#05070c] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0b1321]/80 p-8 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mb-6 space-y-2 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-white/60">OVM Portal</p>
          <h1 className="text-2xl font-semibold text-white">Crear cuenta</h1>
          <p className="text-sm text-white/60">
            Registra un usuario asociado a un tenant existente.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-4">
          <label className="text-sm text-white/70">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
              placeholder="Jane Doe"
            />
          </label>
          <label className="text-sm text-white/70">
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
          <label className="text-sm text-white/70">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-white/70">
              Tenant ID
              <input
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
                placeholder="default"
              />
            </label>
            <label className="text-sm text-white/70">
              Rol
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070c]/80 px-3 py-3 text-sm text-white outline-none ring-emerald-400/30 focus:ring"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="superadmin">Superadmin</option>
              </select>
              <p className="mt-1 text-xs text-white/50">
                El rol <span className="font-semibold text-emerald-200">superadmin</span> puede gestionar todos los tenants. Úsalo solo si necesitas control global; también puedes asignarlo editando manualmente <code>data/users.json</code>.
              </p>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#3ad4ad]/50 bg-[#3ad4ad]/20 px-4 py-3 text-sm font-semibold text-[#3ad4ad] transition hover:-translate-y-0.5 hover:bg-[#3ad4ad]/30 disabled:opacity-60"
          >
            {loading ? "Creando usuario…" : "Registrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/60">
          ¿Ya tienes cuenta?{" "}
          <Link
            href="/login"
            className="font-semibold text-[#3ad4ad] hover:text-[#7ce3ff]"
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
