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
    return "bg-amber-500/20 text-amber-200 border-amber-500/40";
  if (role === "admin")
    return "bg-blue-500/20 text-blue-200 border-blue-500/40";
  return "bg-white/10 text-white/70 border-white/15";
};

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        {success && (
          <div className="mb-4 p-4 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-emerald-200">
            {success}
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
          <form
            onSubmit={handleCreate}
            className="mb-8 p-6 bg-white/5 rounded-xl border border-white/10"
          >
            <h2 className="text-xl font-semibold mb-4">Nuevo Usuario</h2>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm text-white/60">
                Nombre
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </label>
              <label className="block text-sm text-white/60">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </label>
              <label className="block text-sm text-white/60">
                Contraseña
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                />
              </label>
              <label className="block text-sm text-white/60">
                Tenant
                <select
                  value={form.tenantId}
                  onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                  required
                  className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                >
                  {tenants.length === 0 && <option value="">Sin tenants</option>}
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-white/60 col-span-2">
                Rol
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  {isSuperadmin && <option value="superadmin">Superadmin</option>}
                </select>
              </label>
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
                <th className="px-6 py-3 text-left text-sm font-semibold">Tenants</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Rol</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">2FA</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Creado</th>
                <th className="px-6 py-3 text-right text-sm font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-white/50">
                    No hay usuarios para mostrar.
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className="border-t border-white/10">
                  <td className="px-6 py-4">
                    {user.name}
                    {user.id === selfId && (
                      <span className="ml-2 text-xs text-white/40">(tú)</span>
                    )}
                  </td>
                  <td className="px-6 py-4">{user.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.memberships.length === 0 && (
                        <span className="text-xs text-white/40">Sin tenant</span>
                      )}
                      {user.memberships.map((m) => (
                        <span
                          key={m.tenantId}
                          className={`px-2 py-1 rounded text-xs border ${
                            m.role === "admin"
                              ? "bg-blue-500/15 text-blue-200 border-blue-500/30"
                              : "bg-white/10 text-white/70 border-white/15"
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
                          ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
                          : "bg-white/5 text-white/50 border-white/10"
                      }`}
                    >
                      {user.twoFactorEnabled ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setModal({ type: "edit", user })}
                        className="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setModal({ type: "password", user })}
                        className="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg"
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
                        className="px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
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
          <label className="block text-sm text-white/60">
            Nombre
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
            />
          </label>
          <label className="block text-sm text-white/60">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
            />
          </label>
        </div>

        {isSuperadmin ? (
          <>
            <label className="block text-sm text-white/60">
              Rol global
              <select
                value={globalRole ?? ""}
                onChange={(e) =>
                  setGlobalRole(
                    e.target.value === "superadmin" ? "superadmin" : null,
                  )
                }
                className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
              >
                <option value="">Usuario / Admin por tenant</option>
                <option value="superadmin">Superadmin (acceso global)</option>
              </select>
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-white/60">Membresías por tenant</p>
                <button
                  type="button"
                  onClick={addMembership}
                  disabled={
                    memberships.filter((m) => m.tenantId).length >= tenants.length ||
                    tenants.length === 0
                  }
                  className="text-xs px-2 py-1 bg-white/10 hover:bg-white/20 rounded disabled:opacity-40"
                >
                  + Añadir tenant
                </button>
              </div>
              <div className="space-y-2">
                {memberships.length === 0 && (
                  <p className="text-xs text-white/40">
                    Sin membresías. El usuario no verá ningún tenant.
                  </p>
                )}
                {memberships.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={m.tenantId}
                      onChange={(e) => setMembershipTenant(i, e.target.value)}
                      className="flex-1 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-sm"
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
                      className="px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-sm"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMembership(i)}
                      className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-sm text-white/60">
              Tenant por defecto
              <select
                value={defaultTenantId}
                onChange={(e) => setDefaultTenantId(e.target.value)}
                className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
              >
                <option value="">—</option>
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {tenants.find((t) => t.id === m.tenantId)?.name ?? m.tenantId}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
              <span className="text-sm text-white/70">
                Doble factor (2FA)
                <span className="block text-xs text-white/45">
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
          <label className="block text-sm text-white/60">
            Rol en tu tenant ({adminTenantId})
            <select
              value={tenantRole}
              onChange={(e) =>
                setTenantRole(e.target.value === "admin" ? "admin" : "user")
              }
              className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
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
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg"
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
        <label className="block text-sm text-white/60">
          Nueva contraseña (mín. 6)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
          />
        </label>
        <label className="block text-sm text-white/60">
          Confirmar contraseña
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg"
          />
        </label>
        {mismatch && (
          <p className="text-sm text-red-300">Las contraseñas no coinciden.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg"
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
        <p className="text-white/80">
          ¿Seguro que deseas eliminar a{" "}
          <span className="font-semibold">{user.name}</span> ({user.email})? Esta
          acción no se puede deshacer.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-6 py-2 bg-red-500/80 hover:bg-red-500 text-white font-semibold rounded-lg disabled:opacity-50"
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
        className="w-full max-w-lg bg-[#0b0f17] border border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
