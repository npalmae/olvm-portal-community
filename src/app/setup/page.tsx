"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { SixmanagerMark } from "@/components/SixmanagerMark";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const inputCls = "mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wide text-gray-500";
const btnPrimary = "rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const btnSecondary = "rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineId, setEngineId] = useState("");

  // Step 1: superadmin
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminPass2, setAdminPass2] = useState("");

  // Step 2: engine
  const [engName, setEngName] = useState("");
  const [engUrl, setEngUrl] = useState("");
  const [engUser, setEngUser] = useState("admin@internal");
  const [engPass, setEngPass] = useState("");
  const [engInsecure, setEngInsecure] = useState(true);
  const [engineTested, setEngineTested] = useState(false);

  // Step 3: tenant
  const [tenantName, setTenantName] = useState("");
  const [tenantTag, setTenantTag] = useState("");

  // Step 4: email
  const [emailKey, setEmailKey] = useState("");
  const [emailFrom, setEmailFrom] = useState("");

  // Step 5: ssh
  const [sshUser, setSshUser] = useState("root");
  const [sshPass, setSshPass] = useState("");

  const steps = [
    { n: 1, label: "Superadmin" },
    { n: 2, label: "Motor OLVM" },
    { n: 3, label: "Tenant" },
    { n: 4, label: "Email" },
    { n: 5, label: "SSH Hosts" },
    { n: 6, label: "Listo" },
  ] as const;

  const api = async (url: string, body: Record<string, unknown>, method = "POST") => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: "Error de conexión" }));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  };

  const handleSuperadmin = async () => {
    setLoading(true); setError(null);
    try {
      await api("/api/setup/superadmin", { name: adminName, email: adminEmail, password: adminPass });
      const result = await signIn("credentials", { email: adminEmail, password: adminPass, redirect: false });
      if (!result?.ok) throw new Error("No se pudo iniciar sesión automáticamente");
      setStep(2);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleEngineTest = async () => {
    setLoading(true); setError(null);
    try {
      await api("/api/admin/engines/test", { baseUrl: engUrl, username: engUser, password: engPass, allowInsecure: engInsecure });
      setEngineTested(true);
    } catch (e) { setError((e as Error).message); setEngineTested(false); }
    finally { setLoading(false); }
  };

  const handleEngineSave = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api("/api/admin/engines", { name: engName, baseUrl: engUrl, username: engUser, password: engPass, allowInsecure: engInsecure });
      setEngineId(data.id);
      setStep(3);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleTenant = async () => {
    setLoading(true); setError(null);
    try {
      await api("/api/admin/clusters", { name: tenantName, engineId, tag: tenantTag });
      setStep(4);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleEmail = async (skip: boolean) => {
    if (skip) { setStep(5); return; }
    setLoading(true); setError(null);
    try {
      await api("/api/admin/email", { apiKey: emailKey, fromAddress: emailFrom, enabled: true }, "PUT");
      setStep(5);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleSsh = async (skip: boolean) => {
    if (skip) { setStep(6); return; }
    setLoading(true); setError(null);
    try {
      await api("/api/admin/system-secrets", { hostSshUser: sshUser, hostSshPassword: sshPass }, "PUT");
      setStep(6);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex flex-col items-center">
          <SixmanagerMark />
          <h1 className="mt-3 text-xl font-bold text-gray-900">OLVM Portal — Instalación</h1>
        </div>

        {/* Progress */}
        {step > 0 && step < 6 && (
          <div className="mb-6 flex items-center justify-center gap-2">
            {steps.filter(s => s.n < 6).map((s) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= s.n ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-400"}`}>
                  {step > s.n ? "✓" : s.n}
                </div>
                <span className={`text-xs ${step >= s.n ? "font-medium text-gray-700" : "text-gray-400"}`}>{s.label}</span>
                {s.n < 5 && <div className={`h-px w-6 ${step > s.n ? "bg-blue-400" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border bg-white p-6 shadow-sm" style={{ borderColor: "var(--border)" }}>

          {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center">
              <h2 className="text-lg font-bold text-gray-900">Bienvenido</h2>
              <p className="mt-2 text-sm text-gray-500">Este wizard te guiará por la configuración inicial del portal en unos minutos.</p>
              <div className="mt-5 space-y-1.5 text-left text-xs text-gray-500">
                <p>1. Crear el usuario <strong>superadmin</strong></p>
                <p>2. Conectar el <strong>motor OLVM</strong></p>
                <p>3. Crear el primer <strong>tenant</strong> con su tag</p>
                <p>4. Configurar <strong>email</strong> (opcional)</p>
                <p>5. Configurar <strong>SSH de hosts</strong> OLVM (opcional)</p>
              </div>
              <button onClick={() => setStep(1)} className={`${btnPrimary} mt-6 w-full`}>Comenzar →</button>
            </div>
          )}

          {/* Step 1: Superadmin */}
          {step === 1 && (
            <div>
              <h2 className="mb-1 text-sm font-bold text-gray-900">Crear superadmin</h2>
              <p className="mb-4 text-xs text-gray-400">Será el administrador global del portal.</p>
              <div className="space-y-3">
                <div><label className={labelCls}>Nombre</label><input className={inputCls} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Administrador" /></div>
                <div><label className={labelCls}>Email</label><input className={inputCls} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" /></div>
                <div><label className={labelCls}>Contraseña (mín. 8 caracteres)</label><input className={inputCls} type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="••••••••" /></div>
                <div><label className={labelCls}>Confirmar contraseña</label><input className={inputCls} type="password" value={adminPass2} onChange={(e) => setAdminPass2(e.target.value)} placeholder="••••••••" /></div>
              </div>
              <button onClick={handleSuperadmin} disabled={loading || !adminName || !adminEmail || adminPass.length < 8 || adminPass !== adminPass2} className={`${btnPrimary} mt-5 w-full`}>
                {loading ? "Creando..." : "Crear y continuar →"}
              </button>
            </div>
          )}

          {/* Step 2: Engine */}
          {step === 2 && (
            <div>
              <h2 className="mb-1 text-sm font-bold text-gray-900">Conectar motor OLVM</h2>
              <p className="mb-4 text-xs text-gray-400">Datos de acceso a la API REST del engine (oVirt/OLVM).</p>
              <div className="space-y-3">
                <div><label className={labelCls}>Nombre descriptivo</label><input className={inputCls} value={engName} onChange={(e) => setEngName(e.target.value)} placeholder="Engine Producción" /></div>
                <div><label className={labelCls}>URL del engine</label><input className={inputCls} type="url" value={engUrl} onChange={(e) => setEngUrl(e.target.value)} placeholder="https://engine.example.com/ovirt-engine/api" /></div>
                <div><label className={labelCls}>Usuario</label><input className={inputCls} value={engUser} onChange={(e) => setEngUser(e.target.value)} placeholder="admin@internal" /></div>
                <div><label className={labelCls}>Contraseña</label><input className={inputCls} type="password" value={engPass} onChange={(e) => setEngPass(e.target.value)} placeholder="••••••••" /></div>
                <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={engInsecure} onChange={(e) => setEngInsecure(e.target.checked)} className="h-4 w-4 accent-blue-600" /> Permitir certificados self-signed</label>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button onClick={handleEngineTest} disabled={loading || !engUrl || !engPass} className={btnSecondary}>Probar conexión</button>
                {engineTested && <span className="text-xs font-medium text-emerald-600">✓ Conexión exitosa</span>}
              </div>
              <button onClick={handleEngineSave} disabled={loading || !engName || !engUrl || !engPass} className={`${btnPrimary} mt-5 w-full`}>
                {loading ? "Guardando..." : "Guardar y continuar →"}
              </button>
            </div>
          )}

          {/* Step 3: Tenant */}
          {step === 3 && (
            <div>
              <h2 className="mb-1 text-sm font-bold text-gray-900">Crear tenant</h2>
              <p className="mb-4 text-xs text-gray-400">El tenant asocia el portal con un tag de OLVM para el aislamiento multitenant.</p>
              <div className="space-y-3">
                <div><label className={labelCls}>Nombre del tenant</label><input className={inputCls} value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="produccion" /></div>
                <div><label className={labelCls}>Tag OLVM</label><input className={inputCls} value={tenantTag} onChange={(e) => setTenantTag(e.target.value)} placeholder="produccion" /></div>
                <p className="text-[10px] text-gray-400">Las VMs con este tag en OLVM pertenecerán a este tenant. El tag se crea automáticamente si no existe.</p>
              </div>
              <button onClick={handleTenant} disabled={loading || !tenantName || !tenantTag} className={`${btnPrimary} mt-5 w-full`}>
                {loading ? "Creando..." : "Crear tenant →"}
              </button>
            </div>
          )}

          {/* Step 4: Email */}
          {step === 4 && (
            <div>
              <h2 className="mb-1 text-sm font-bold text-gray-900">Configurar email (opcional)</h2>
              <p className="mb-4 text-xs text-gray-400">Necesario para 2FA y notificaciones. Usamos Resend.</p>
              <div className="space-y-3">
                <div><label className={labelCls}>Resend API Key</label><input className={inputCls} type="password" value={emailKey} onChange={(e) => setEmailKey(e.target.value)} placeholder="re_..." /></div>
                <div><label className={labelCls}>Email remitente</label><input className={inputCls} type="email" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="noreply@example.com" /></div>
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={() => handleEmail(true)} className={`${btnSecondary} flex-1`}>Saltar</button>
                <button onClick={() => handleEmail(false)} disabled={loading || (!emailKey && !emailFrom)} className={`${btnPrimary} flex-1`}>
                  {loading ? "Guardando..." : "Guardar →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 5: SSH */}
          {step === 5 && (
            <div>
              <h2 className="mb-1 text-sm font-bold text-gray-900">SSH hosts OLVM (opcional)</h2>
              <p className="mb-4 text-xs text-gray-400">Credenciales SSH de los hosts OLVM. Necesarias para importar OVAs/qcow2 y conversiones.</p>
              <div className="space-y-3">
                <div><label className={labelCls}>Usuario SSH</label><input className={inputCls} value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="root" /></div>
                <div><label className={labelCls}>Password SSH</label><input className={inputCls} type="password" value={sshPass} onChange={(e) => setSshPass(e.target.value)} placeholder="••••••••" /></div>
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={() => handleSsh(true)} className={`${btnSecondary} flex-1`}>Saltar</button>
                <button onClick={() => handleSsh(false)} disabled={loading || !sshPass} className={`${btnPrimary} flex-1`}>
                  {loading ? "Guardando..." : "Guardar →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 6: Done */}
          {step === 6 && (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">¡Configuración completa!</h2>
              <p className="mt-2 text-sm text-gray-500">El portal está listo para usar. Serás redirigido al dashboard.</p>
              <button onClick={() => router.push("/")} className={`${btnPrimary} mt-6 w-full`}>Ir al portal →</button>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[10px] text-gray-400">OLVM Portal · Powered by <a href="https://sixmanager.com" className="hover:text-gray-600">Sixmanager</a></p>
      </div>
    </div>
  );
}
