"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Membership = {
  tenantId: string;
  role: "user" | "admin";
};

type User = {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  defaultTenantId: string;
  role: "user" | "admin" | "superadmin";
  globalRole: "superadmin" | null;
  memberships: Membership[];
  twoFactorEnabled: boolean;
  createdAt: string;
};

type Tenant = {
  id: string;
  name: string;
  baseUrl: string;
};

type ModalState =
  | { type: "closed" }
  | { type: "edit"; user: User }
  | { type: "delete"; user: User }
  | { type: "password"; user: User };

type ApiKeyEntry = {
  id: string;
  name: string;
  key?: string;
  keyPreview: string;
  createdAt: string;
  active: boolean;
  lastUsed?: string;
};

const parseJsonSafe = async (res: Response) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text ? { error: text } : null;
  }
};

const roleBadge = (role: string) => {
  if (role === "superadmin")
    return "bg-amber-100 text-amber-800 border-amber-300";
  if (role === "admin")
    return "bg-blue-100 text-blue-800 border-blue-300";
  return "bg-gray-100 text-gray-600 border-gray-200";
};

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: "closed" });
  const [busyId, setBusyId] = useState<string | null>(null);

  // Estado del formulario de creación
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    tenantId: "",
    role: "user",
  });
  const [submitting, setSubmitting] = useState(false);

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";
  const adminTenantId =
    session?.user?.defaultTenantId ?? session?.user?.tenantId ?? "";
  const selfId = session?.user?.id ?? "";

  const loadUsers = useCallback(async () => {
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
  }, []);

  const loadTenants = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants");
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? "Error cargando tenants");
      setTenants(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length) {
        setForm((prev) => ({
          ...prev,
          tenantId: prev.tenantId || data[0].id,
        }));
      }
    } catch {
      // No bloquea la página si los tenants no cargan
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    if (
      session.user.role !== "superadmin" &&
      session.user.role !== "admin"
    ) {
      router.push("/");
      return;
    }
    loadUsers();
    loadTenants();
  }, [session, status, router, loadUsers, loadTenants]);

  const loadApiKeys = async () => {
    try {
      const res = await fetch("/api/admin/api-keys");
      if (res.ok) setApiKeys(await res.json());
    } catch { /* noop */ }
  };

  useEffect(() => {
    if (isSuperadmin) loadApiKeys();
  }, [isSuperadmin]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");
      setNewKeyName("");
      await loadApiKeys();
      setRevealedKeyId(data.id);
    } catch (e) { setError((e as Error).message); }
    finally { setCreatingKey(false); }
  };

  const handleDeleteKey = async (id: string) => {
    await fetch(`/api/admin/api-keys?id=${id}`, { method: "DELETE" });
    await loadApiKeys();
  };

  const handleToggleKey = async (id: string) => {
    await fetch(`/api/admin/api-keys?id=${id}&action=toggle`, { method: "DELETE" });
    await loadApiKeys();
  };

  // Auto-dismiss alertas
  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [error, success]);

  const tenantName = (tenantId: string) =>
    tenants.find((t) => t.id === tenantId)?.name ?? tenantId;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name,
          tenantId: form.tenantId,
          role: form.role,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Error creando usuario");
      setForm({ email: "", password: "", name: "", tenantId: tenants[0]?.id ?? "", role: "user" });
      setShowForm(false);
      setSuccess("Usuario creado");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (userId: string, payload: Record<string, unknown>) => {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Error actualizando usuario");
      setSuccess("Usuario actualizado");
      setModal({ type: "closed" });
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Error eliminando usuario");
      setSuccess("Usuario eliminado");
      setModal({ type: "closed" });
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] text-gray-700 flex items-center justify-center">
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1 font-semibold text-gray-800" style={{ fontSize: "13px" }}>
              <button
                onClick={() => router.push("/")}
                className="flex shrink-0 items-center gap-1 hover:text-blue-600"
                title="Inicio"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z"/>
                  <path d="M6 14.5V9h4v5.5"/>
                </svg>
                OLVM-PORTAL
              </button>
              <span className="shrink-0 text-gray-400">/</span>
              <button
                onClick={() => router.push("/admin/clusters")}
                className="shrink-0 text-gray-600 hover:text-blue-600"
              >
                Configuración
              </button>
              <span className="shrink-0 text-gray-400">/</span>
              <span className="truncate text-gray-700">Usuarios</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">Administración de Usuarios</h1>
            <p className="text-xs text-gray-500">Gestiona usuarios del portal</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/admin/email")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Config Email
            </button>
            <button
              onClick={() => router.push("/admin/clusters")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Clusters
            </button>
            <button
              onClick={() => router.push("/admin/branding")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Branding
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>
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
          <form
            onSubmit={handleCreate}
            className="mb-8 p-6 bg-white rounded-lg border" style={{ borderColor: "var(--border)" }}
          >
            <h2 className="text-lg font-semibold mb-4 text-gray-900">Nuevo Usuario</h2>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm text-gray-500">
                Nombre
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
                />
              </label>
              <label className="block text-sm text-gray-500">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
                />
              </label>
              <label className="block text-sm text-gray-500">
                Contraseña
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
                />
              </label>
              <label className="block text-sm text-gray-500">
                Tenant
                <select
                  value={form.tenantId}
                  onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                  required
                  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
                >
                  {tenants.length === 0 && <option value="">Sin tenants</option>}
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-gray-500 col-span-2">
                Rol
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  {isSuperadmin && <option value="superadmin">superadmin</option>}
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-60"
            >
              {submitting ? "Creando..." : "Crear"}
            </button>
          </form>
        )}

        <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nombre</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tenants</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rol</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">2FA</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Creado</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                    No hay usuarios para mostrar.
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-6 py-4">
                    {user.name}
                    {user.id === selfId && (
                      <span className="ml-2 text-xs text-gray-400">(tú)</span>
                    )}
                  </td>
                  <td className="px-6 py-4">{user.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.memberships.length === 0 && (
                        <span className="text-xs text-gray-400">Sin tenant</span>
                      )}
                      {user.memberships.map((m) => (
                        <span
                          key={m.tenantId}
                          className={`px-2 py-1 rounded text-xs border ${
                            m.role === "admin"
                              ? "bg-blue-100 text-blue-700 border-blue-300"
                              : "bg-gray-100 text-gray-700 border-gray-200"
                          }`}
                          title={`${tenantName(m.tenantId)} (${m.role})`}
                        >
                          {tenantName(m.tenantId)} · {m.role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm border ${roleBadge(
                        user.role,
                      )}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded text-xs border ${
                        user.twoFactorEnabled
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }`}
                    >
                      {user.twoFactorEnabled ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setModal({ type: "edit", user })}
                        className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setModal({ type: "password", user })}
                        className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
                      >
                        Clave
                      </button>
                      <button
                        onClick={() => setModal({ type: "delete", user })}
                        disabled={user.id === selfId}
                        title={
                          user.id === selfId
                            ? "No puedes eliminar tu propia cuenta"
                            : "Eliminar usuario"
                        }
                        className="px-3 py-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal.type === "edit" && (
        <EditModal
          user={modal.user}
          tenants={tenants}
          isSuperadmin={isSuperadmin}
          adminTenantId={adminTenantId}
          busy={busyId === modal.user.id}
          onClose={() => setModal({ type: "closed" })}
          onSave={(payload) => handleUpdate(modal.user.id, payload)}
        />
      )}

      {modal.type === "password" && (
        <PasswordModal
          user={modal.user}
          busy={busyId === modal.user.id}
          onClose={() => setModal({ type: "closed" })}
          onSave={(password) =>
            handleUpdate(modal.user.id, { password })
          }
        />
      )}

      {modal.type === "delete" && (
        <DeleteModal
          user={modal.user}
          busy={busyId === modal.user.id}
          onClose={() => setModal({ type: "closed" })}
          onConfirm={() => handleDelete(modal.user.id)}
        />
      )}
    </div>
  );
}

type EditModalProps = {
  user: User;
  tenants: Tenant[];
  isSuperadmin: boolean;
  adminTenantId: string;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
};

function EditModal({
  user,
  tenants,
  isSuperadmin,
  adminTenantId,
  busy,
  onClose,
  onSave,
}: EditModalProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [globalRole, setGlobalRole] = useState<"superadmin" | null>(
    user.globalRole,
  );
  const [memberships, setMemberships] = useState<Membership[]>(
    user.memberships.length
      ? user.memberships
      : user.tenantId
        ? [{ tenantId: user.tenantId, role: "user" }]
        : [],
  );
  const [defaultTenantId, setDefaultTenantId] = useState(
    user.defaultTenantId || user.tenantId,
  );
  const [twoFactor, setTwoFactor] = useState(user.twoFactorEnabled !== false);

  // Para tenant admin: solo se edita el rol dentro de su tenant
  const tenantAdminMembership = memberships.find(
    (m) => m.tenantId === adminTenantId,
  );
  const [tenantRole, setTenantRole] = useState<"user" | "admin">(
    tenantAdminMembership?.role ?? "user",
  );

  const [userApiKeys, setUserApiKeys] = useState<ApiKeyEntry[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);

  const loadUserKeys = async () => {
    try {
      const res = await fetch(`/api/admin/api-keys?userId=${user.id}`);
      if (res.ok) setUserApiKeys(await res.json());
    } catch { /* noop */ }
  };

  useEffect(() => {
    if (isSuperadmin) loadUserKeys();
  }, [isSuperadmin, user.id]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, userId: user.id, userEmail: user.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");
      setNewKeyName("");
      setUserApiKeys((current) => [
        {
          ...data,
          keyPreview: `${data.key.slice(0, 8)}...`,
        },
        ...current.filter((key) => key.id !== data.id),
      ]);
      setRevealedKeyId(data.id);
    } catch { /* noop */ }
    finally { setCreatingKey(false); }
  };

  const handleDeleteKey = async (id: string) => {
    await fetch(`/api/admin/api-keys?id=${id}`, { method: "DELETE" });
    await loadUserKeys();
  };

  const handleToggleKey = async (id: string) => {
    await fetch(`/api/admin/api-keys?id=${id}&action=toggle`, { method: "DELETE" });
    await loadUserKeys();
  };

  const addMembership = () => {
    const available = tenants.filter(
      (t) => !memberships.some((m) => m.tenantId === t.id),
    );
    if (available.length > 0) {
      setMemberships([...memberships, { tenantId: "", role: "user" }]);
    }
  };

  const removeMembership = (index: number) => {
    setMemberships(memberships.filter((_, i) => i !== index));
  };

  const setMembershipTenant = (index: number, tenantId: string) => {
    setMemberships(
      memberships.map((m, i) => (i === index ? { ...m, tenantId } : m)),
    );
  };

  const setMembershipRole = (index: number, role: "user" | "admin") => {
    setMemberships(
      memberships.map((m, i) => (i === index ? { ...m, role } : m)),
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { name, email };

    if (isSuperadmin) {
      payload.globalRole = globalRole === "superadmin" ? "superadmin" : null;
      payload.memberships = memberships.filter((m) => m.tenantId);
      payload.defaultTenantId = defaultTenantId;
      payload.twoFactorEnabled = twoFactor;
    } else {
      payload.membershipRole = tenantRole;
    }
    onSave(payload);
  };

  return (
    <ModalShell title={`Editar usuario · ${user.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm text-gray-600">
            Nombre
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
            />
          </label>
          <label className="block text-sm text-gray-600">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
            />
          </label>
        </div>

        {isSuperadmin ? (
          <>
            <label className="block text-sm text-gray-600">
              Rol global
              <select
                value={globalRole ?? ""}
                onChange={(e) =>
                  setGlobalRole(
                    e.target.value === "superadmin" ? "superadmin" : null,
                  )
                }
                className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
              >
                <option value="">Usuario / Admin por tenant</option>
                <option value="superadmin">Superadmin (acceso global)</option>
              </select>
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">Membresías por tenant</p>
                <button
                  type="button"
                  onClick={addMembership}
                  disabled={
                    memberships.filter((m) => m.tenantId).length >= tenants.length ||
                    tenants.length === 0
                  }
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-40"
                >
                  + Añadir tenant
                </button>
              </div>
              <div className="space-y-2">
                {memberships.length === 0 && (
                  <p className="text-xs text-gray-400">
                    Sin membresías. El usuario no verá ningún tenant.
                  </p>
                )}
                {memberships.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={m.tenantId}
                      onChange={(e) => setMembershipTenant(i, e.target.value)}
                      className="flex-1 px-2 py-1 bg-white border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="">Selecciona tenant…</option>
                      {tenants
                        .filter(
                          (t) =>
                            t.id === m.tenantId ||
                            !memberships.some((mm) => mm.tenantId === t.id),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.id})
                          </option>
                        ))}
                    </select>
                    <select
                      value={m.role}
                      onChange={(e) =>
                        setMembershipRole(
                          i,
                          e.target.value === "admin" ? "admin" : "user",
                        )
                      }
                      className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMembership(i)}
                      className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-sm text-gray-600">
              Tenant por defecto
              <select
                value={defaultTenantId}
                onChange={(e) => setDefaultTenantId(e.target.value)}
                className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
              >
                <option value="">—</option>
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {tenants.find((t) => t.id === m.tenantId)?.name ?? m.tenantId}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-700">
                Doble factor (2FA)
                <span className="block text-xs text-gray-500">
                  {twoFactor
                    ? "Se exige código por email al iniciar sesión"
                    : "Login directo solo con contraseña"}
                </span>
              </span>
              <input
                type="checkbox"
                checked={twoFactor}
                onChange={(e) => setTwoFactor(e.target.checked)}
                className="h-5 w-5 accent-[#3ad4ad]"
              />
            </label>
          </>
        ) : (
          <label className="block text-sm text-gray-600">
            Rol en tu tenant ({adminTenantId})
            <select
              value={tenantRole}
              onChange={(e) =>
                setTenantRole(e.target.value === "admin" ? "admin" : "user")
              }
              className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-6 py-2 bg-[#3ad4ad] hover:bg-[#2bc095] text-black font-semibold rounded-lg disabled:opacity-50"
          >
            {busy ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>

        {isSuperadmin && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">API Keys</h3>
            <p className="text-xs text-gray-500 mb-3">
              Claves read-only para {user.email}. Heredan los tenants de este usuario.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Nombre (ej: Billing)"
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
              />
              <button
                onClick={handleCreateKey}
                disabled={creatingKey || !newKeyName.trim()}
                className="px-4 py-1.5 bg-[#3ad4ad] hover:bg-[#2bc095] text-black font-semibold rounded-lg text-sm disabled:opacity-50"
              >
                {creatingKey ? "…" : "+ Key"}
              </button>
            </div>
            {userApiKeys.length > 0 && (
              <div className="space-y-2">
                {userApiKeys.map((k) => (
                  <div key={k.id} className="rounded-md bg-white border border-gray-100 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium text-gray-800 truncate">{k.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${k.active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}>
                        {k.active ? "ON" : "OFF"}
                      </span>
                      <button onClick={() => handleToggleKey(k.id)} className="text-[10px] text-gray-500 hover:text-blue-600">{k.active ? "Desact." : "Activ."}</button>
                      <button onClick={() => handleDeleteKey(k.id)} className="text-[10px] text-red-500 hover:text-red-700">Elim.</button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {revealedKeyId === k.id && k.key ? (
                        <>
                          <code className="flex-1 text-[11px] text-gray-600 bg-gray-50 rounded px-2 py-1 break-all">{k.key}</code>
                          <button
                            onClick={() => {
                              const ta = document.createElement("textarea");
                              ta.value = k.key ?? "";
                              ta.style.cssText = "position:fixed;opacity:0";
                              document.body.appendChild(ta);
                              ta.select();
                              try { document.execCommand("copy"); } catch {}
                              document.body.removeChild(ta);
                            }}
                            className="shrink-0 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-100"
                          >Copiar</button>
                          <button onClick={() => setRevealedKeyId(null)} className="shrink-0 text-[10px] text-gray-500 hover:text-gray-700">Ocultar</button>
                        </>
                      ) : (
                        <>
                          <code className="text-[11px] text-gray-400 font-mono">{k.keyPreview}</code>
                          {k.key && (
                            <button onClick={() => setRevealedKeyId(k.id)} className="text-[10px] text-blue-600 hover:text-blue-800">Mostrar</button>
                          )}
                        </>
                      )}
                    </div>
                    {revealedKeyId === k.id && k.key && (
                      <div className="mt-1.5 rounded bg-gray-50 border border-gray-200 px-2.5 py-1.5">
                        <p className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5">Uso</p>
                        <code className="text-[10px] text-gray-600 break-all">curl -H "X-API-Key: {k.key}" http://10.176.160.124:3000/api/v1/vms</code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ModalShell>
  );
}

type PasswordModalProps = {
  user: User;
  busy: boolean;
  onClose: () => void;
  onSave: (password: string) => void;
};

function PasswordModal({ user, busy, onClose, onSave }: PasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = password.length > 0 && password !== confirm;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6 || mismatch) return;
    onSave(password);
  };

  return (
    <ModalShell title={`Restablecer clave · ${user.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm text-gray-600">
          Nueva contraseña (mín. 6)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
          />
        </label>
        <label className="block text-sm text-gray-600">
          Confirmar contraseña
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 bg-white border border-gray-200 rounded-lg"
          />
        </label>
        {mismatch && (
          <p className="text-sm text-red-600">Las contraseñas no coinciden.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || password.length < 6 || mismatch}
            className="px-6 py-2 bg-[#3ad4ad] hover:bg-[#2bc095] text-black font-semibold rounded-lg disabled:opacity-50"
          >
            {busy ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type DeleteModalProps = {
  user: User;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function DeleteModal({ user, busy, onClose, onConfirm }: DeleteModalProps) {
  return (
    <ModalShell title="Eliminar usuario" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-gray-800">
          ¿Seguro que deseas eliminar a{" "}
          <span className="font-semibold">{user.name}</span> ({user.email})? Esta
          acción no se puede deshacer.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {busy ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
