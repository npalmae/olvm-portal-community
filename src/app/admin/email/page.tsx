"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type EmailConfig = {
  provider: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  fromAddress: string;
  enabled: boolean;
};

export default function EmailConfigPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || !isSuperadmin) {
      router.push("/");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/admin/email");
        if (!res.ok) throw new Error("No autorizado");
        const data = await res.json();
        setConfig(data);
        setFromAddress(data.fromAddress ?? "");
        setEnabled(data.enabled ?? true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [session, status, isSuperadmin, router]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          fromAddress,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");
      setConfig(data);
      setApiKey("");
      setSuccess("Configuración guardada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [apiKey, fromAddress, enabled]);

  const sendTest = useCallback(async () => {
    if (!testEmail) { setError("Ingresa un email para probar"); return; }
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");
      setSuccess(`Email de prueba enviado a ${testEmail}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }, [testEmail]);

  if (loading) return <div className="p-8 text-sm text-gray-500">Cargando...</div>;
  if (!isSuperadmin) return null;

  return (
    <div className="min-h-screen p-8" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <div className="mb-2 flex gap-2">
            <button
              onClick={() => router.push("/admin/clusters")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              ← Setup Cluster
            </button>
            <button
              onClick={() => router.push("/")}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
            >
              ← Home
            </button>
          </div>
          <h1 className="mt-2 text-lg font-bold text-gray-900">Configuración de Email</h1>
          <p className="text-xs text-gray-500">Notificaciones, códigos 2FA y alertas del sistema</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>
        )}

        <div className="space-y-4 rounded-lg border bg-white p-6" style={{ borderColor: "var(--border)" }}>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Proveedor</label>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">Resend</span>
              {config?.hasApiKey ? (
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">API Key: {config.apiKeyHint}</span>
              ) : (
                <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">Sin API Key</span>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              API Key de Resend
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.hasApiKey ? `Actual: ${config.apiKeyHint} (dejar vacío para mantener)` : "re_xxxxxxxxxxxx"}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />
            <p className="mt-1 text-[10px] text-gray-400">Obtén tu API key en <a href="https://resend.com/api-keys" target="_blank" rel="noopener" className="text-blue-500 hover:underline">resend.com/api-keys</a></p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Email remitente (From)
            </label>
            <input
              type="email"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="noreply@tudominio.com"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />
            <p className="mt-1 text-[10px] text-gray-400">Debe ser un dominio verificado en Resend</p>
          </div>

          <label className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-sm font-medium text-gray-700">Email habilitado</span>
              <p className="text-[10px] text-gray-400">Si está apagado, los códigos 2FA se muestran en consola del servidor</p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-5 w-5"
            />
          </label>

          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>

        <div className="mt-6 rounded-lg border bg-white p-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-bold text-gray-900">Enviar email de prueba</h2>
          <div className="flex gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="destino@ejemplo.com"
              className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              onClick={sendTest}
              disabled={testing}
              className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {testing ? "Enviando..." : "Probar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
