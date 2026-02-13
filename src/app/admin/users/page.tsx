"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    
    if (!session?.user) {
      router.push("/login");
      return;
    }
    
    if (session.user.role !== "superadmin" && session.user.role !== "admin") {
      router.push("/");
      return;
    }
    
    loadUsers();
  }, [session, status, router]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Error cargando usuarios");
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, tenantId, role }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error creando usuario");
      }
      
      // Reset form
      setEmail("");
      setPassword("");
      setName("");
      setTenantId("");
      setRole("user");
      setShowForm(false);
      
      // Reload users
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white flex items-center justify-center">
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070c] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Administración de Usuarios</h1>
            <p className="text-white/60">Gestiona usuarios del portal</p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg"
          >
            Volver al Portal
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-500/20 border border-red-500/40 rounded-lg text-red-200">
            {error}
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-6 py-3 bg-[#3ad4ad] hover:bg-[#2bc095] text-black font-semibold rounded-lg"
          >
            {showForm ? "Cancelar" : "+ Crear Usuario"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mb-8 p-6 bg-white/5 rounded-xl border border-white/10">
            <h2 className="text-xl font-semibold mb-4">Nuevo Usuario</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Tenant ID</label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  required
                  placeholder="tenant-a o tenant-b"
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-white/60 mb-1">Rol</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  {session?.user?.role === "superadmin" && (
                    <option value="superadmin">Superadmin</option>
                  )}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 px-6 py-3 bg-[#3ad4ad] hover:bg-[#2bc095] text-black font-semibold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Creando..." : "Crear Usuario"}
            </button>
          </form>
        )}

        <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full">
            <thead className="bg-white/10">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Nombre</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Tenant</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Rol</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Creado</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-white/10">
                  <td className="px-6 py-4">{user.name}</td>
                  <td className="px-6 py-4">{user.email}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-white/10 rounded text-sm">
                      {user.tenantId}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-sm ${
                      user.role === "superadmin"
                        ? "bg-amber-500/20 text-amber-200"
                        : user.role === "admin"
                        ? "bg-blue-500/20 text-blue-200"
                        : "bg-white/10"
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
