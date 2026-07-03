"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Cluster = {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: "basic" | "token";
  username?: string;
  hasPassword: boolean;
  hasToken: boolean;
  allowInsecure: boolean;
  tag?: string;
  hasCa: boolean;
  createdAt: string;
};

type ModalState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; cluster: Cluster }
  | { type: "delete"; cluster: Cluster };

type TestResult = { ok: boolean; detail: string } | null;

const json = async (res: Response) => {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

export default function AdminClustersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: "closed" });
  const [rowTest, setRowTest] = useState<Record<string, TestResult>>({});

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/clusters");
      if (!res.ok) throw new Error("Error cargando conexiones");
      setClusters(await json(res));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    if (!isSuperadmin) {
      router.push("/");
      return;
    }
    load();
  }, [session, status, router, isSuperadmin, load]);

  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [error, success]);

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/clusters/${id}`, { method: "DELETE" });
      const data = await json(res);
      if (!res.ok) throw new Error(data?.error || "Error eliminando");
      setSuccess("Conexión eliminada");
      setModal({ type: "closed" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const testRow = async (cluster: Cluster) => {
    setRowTest((prev) => ({ ...prev, [cluster.id]: null }));
    try {
      const res = await fetch(`/api/admin/clusters/${cluster.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await json(res);
      setRowTest((prev) => ({
        ...prev,
        [cluster.id]: { ok: data.ok, detail: data.detail },
      }));
    } catch {
      setRowTest((prev) => ({
        ...prev,
        [cluster.id]: { ok: false, detail: "No se pudo probar" },
      }));
    }
  };

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-gray-500"
        style={{ background: "var(--bg)" }}
      >
        Cargando...
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              Conexiones OLVM
            </h1>
            <p className="text-xs text-gray-500">
              Administra los clusters a los que se conecta el portal
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Volver al portal
            </button>
            <button
              onClick={() => setModal({ type: "create" })}
              className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8]"
            >
              + Nueva conexión
            </button>
          </div>
        </div>

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

        <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-gray-500" style={{ borderColor: "var(--border)" }}>
                <th className="px-3 py-2.5 text-left font-semibold">Nombre</th>
                <th className="px-3 py-2.5 text-left font-semibold">Engine</th>
                <th className="px-3 py-2.5 text-left font-semibold">Auth</th>
                <th className="px-3 py-2.5 text-left font-semibold">Tag</th>
                <th className="px-3 py-2.5 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clusters.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                    No hay conexiones configuradas.
                  </td>
                </tr>
              )}
              {clusters.map((c) => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-[11px] text-gray-400">{c.id}</div>
                    {rowTest[c.id] && (
                      <div
                        className={`mt-1 text-[11px] ${rowTest[c.id]!.ok ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {rowTest[c.id]!.ok ? "✓" : "✕"} {rowTest[c.id]!.detail}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{c.baseUrl}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                      {c.authMethod === "token" ? "Token" : "Usuario"}
                    </span>
                    {c.allowInsecure && (
                      <span className="ml-1 text-[11px] text-amber-600">insecure</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.tag ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {c.tag}
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => testRow(c)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Probar
                      </button>
                      <button
                        onClick={() => setModal({ type: "edit", cluster: c })}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setModal({ type: "delete", cluster: c })}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100"
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

      {modal.type === "create" && (
        <ClusterForm
          onClose={() => setModal({ type: "closed" })}
          onSaved={async (msg) => {
            setSuccess(msg);
            setModal({ type: "closed" });
            await load();
          }}
          onError={setError}
        />
      )}

      {modal.type === "edit" && (
        <ClusterForm
          cluster={modal.cluster}
          onClose={() => setModal({ type: "closed" })}
          onSaved={async (msg) => {
            setSuccess(msg);
            setModal({ type: "closed" });
            await load();
          }}
          onError={setError}
        />
      )}

      {modal.type === "delete" && (
        <DeleteModal
          cluster={modal.cluster}
          onClose={() => setModal({ type: "closed" })}
          onConfirm={() => handleDelete(modal.cluster.id)}
        />
      )}
    </div>
  );
}

type FormProps = {
  cluster?: Cluster;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
};

function ClusterForm({ cluster, onClose, onSaved, onError }: FormProps) {
  const editing = Boolean(cluster);
  const [id, setId] = useState(cluster?.id ?? "");
  const [name, setName] = useState(cluster?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(cluster?.baseUrl ?? "");
  const [tag, setTag] = useState(cluster?.tag ?? "");
  const [allowInsecure, setAllowInsecure] = useState(cluster?.allowInsecure ?? true);
  const [authMethod, setAuthMethod] = useState<"basic" | "token">(
    cluster?.authMethod ?? "basic",
  );
  const [username, setUsername] = useState(cluster?.username ?? "admin@internal");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showCa, setShowCa] = useState(Boolean(cluster?.hasCa));
  const [caCert, setCaCert] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<TestResult>(null);
  const [saving, setSaving] = useState(false);

  const inputCls =
    "w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30";
  const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-gray-500";

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      name,
      baseUrl,
      tag,
      allowInsecure,
    };
    if (!editing) payload.id = id;
    if (authMethod === "basic") {
      payload.username = username;
      if (password) payload.password = password;
    } else {
      if (token) payload.token = token;
    }
    if (showCa && caCert) payload.caCert = caCert;
    return payload;
  };

  const runTest = async () => {
    setTesting(true);
    setTestRes(null);
    try {
      const payload = buildPayload();
      // Al editar, probar contra el endpoint del id (usa credenciales guardadas si falta password/token)
      const url = editing
        ? `/api/admin/clusters/${cluster!.id}/test`
        : "/api/admin/clusters/test";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await json(res);
      setTestRes({ ok: data.ok, detail: data.detail });
    } catch {
      setTestRes({ ok: false, detail: "No se pudo probar" });
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = buildPayload();
      const url = editing
        ? `/api/admin/clusters/${cluster!.id}`
        : "/api/admin/clusters";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await json(res);
      if (!res.ok) throw new Error(data?.error || "Error guardando");
      onSaved(editing ? "Conexión actualizada" : "Conexión creada");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-white shadow-xl"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-semibold text-gray-900">
            {editing ? "Editar conexión" : "Nueva conexión OLVM"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <form onSubmit={save} className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Nombre</span>
              <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            {!editing && (
              <label className="block">
                <span className={labelCls}>ID (tenant)</span>
                <input
                  className={`${inputCls} mt-1`}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="tenant-a"
                  required
                />
              </label>
            )}
          </div>

          <label className="block">
            <span className={labelCls}>URL del engine (REST API)</span>
            <input
              className={`${inputCls} mt-1`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://10.141.11.63/ovirt-engine/api"
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Tag (multitenant)</span>
              <input
                className={`${inputCls} mt-1`}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="tenant-a (opcional)"
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                checked={allowInsecure}
                onChange={(e) => setAllowInsecure(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-xs text-gray-600">Permitir certificado autofirmado</span>
            </label>
          </div>

          <div>
            <span className={labelCls}>Autenticación</span>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={authMethod === "basic"}
                  onChange={() => setAuthMethod("basic")}
                />
                Usuario y contraseña
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={authMethod === "token"}
                  onChange={() => setAuthMethod("token")}
                />
                Token
              </label>
            </div>
          </div>

          {authMethod === "basic" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Usuario</span>
                <input className={`${inputCls} mt-1`} value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="block">
                <span className={labelCls}>Contraseña</span>
                <input
                  type="password"
                  className={`${inputCls} mt-1`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? "vacío = mantener actual" : ""}
                  required={!editing}
                />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className={labelCls}>Token (Bearer)</span>
              <textarea
                className={`${inputCls} mt-1 font-mono`}
                rows={2}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={editing ? "vacío = mantener actual" : "OAuth2 token"}
                required={!editing}
              />
            </label>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowCa((s) => !s)}
              className="text-[11px] text-blue-600 hover:underline"
            >
              {showCa ? "− Ocultar CA" : "+ Certificado CA (opcional)"}
            </button>
            {showCa && (
              <textarea
                className={`${inputCls} mt-1 font-mono`}
                rows={3}
                value={caCert}
                onChange={(e) => setCaCert(e.target.value)}
                placeholder="PEM del certificado CA (opcional)"
              />
            )}
          </div>

          {testRes && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${testRes.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}
            >
              {testRes.ok ? "✓" : "✕"} {testRes.detail}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? "Probando..." : "Probar conexión"}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[#2563eb] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteModal({
  cluster,
  onClose,
  onConfirm,
}: {
  cluster: Cluster;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold text-gray-900">Eliminar conexión</h2>
        <p className="mt-2 text-sm text-gray-600">
          ¿Eliminar <span className="font-medium">{cluster.name}</span> ({cluster.id})? El portal
          dejará de conectarse a ese engine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
