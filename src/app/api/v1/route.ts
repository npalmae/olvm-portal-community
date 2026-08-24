import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}/api/v1`;

  return NextResponse.json({
    api: "OLVM Portal API",
    version: "2.1",
    docs: "https://github.com/npalmae/olvm-portal-community/blob/main/docs/API.md",
    authenticatedAs: ctx.userEmail,
    scope: ctx.globalRole === "superadmin" ? "all tenants" : `tenants: ${ctx.tenantIds.join(", ") || "none"}`,
    roles: {
      operator: "Solo lectura (GET)",
      user: "Lectura + despliegue de VMs + acciones de encendido/apagado/reinicio",
      admin: "Todo lo anterior + clonar y eliminar VMs",
      superadmin: "Acceso total a todos los tenants",
    },
    yourRoles: ctx.globalRole === "superadmin"
      ? { global: "superadmin" }
      : ctx.tenantRoles,
    endpoints: {
      overview: {
        method: "GET",
        url: `${base}/overview`,
        roles: "operator+",
        description: "Resumen de todos los tenants accesibles: VMs, CPU, RAM, storage",
      },
      vms: {
        method: "GET",
        url: `${base}/vms`,
        roles: "operator+",
        description: "Listado completo de VMs con recursos, status, métricas y tags",
      },
      storage: {
        method: "GET",
        url: `${base}/storage`,
        roles: "operator+",
        description: "Uso de storage domains por tenant con porcentaje de uso",
      },
      tenant_detail: {
        method: "GET",
        url: `${base}/tenants/{tenantId}`,
        roles: "operator+",
        description: "Detalle de VMs y storage de un tenant específico",
      },
      tenant_vms: {
        method: "GET",
        url: `${base}/tenants/{tenantId}/vms`,
        roles: "operator+",
        description: "VMs de un tenant específico",
      },
      tenant_vm_detail: {
        method: "GET",
        url: `${base}/tenants/{tenantId}/vms/{vmId}`,
        roles: "operator+",
        description: "Detalle de una VM del tenant",
      },
      deploy_vm: {
        method: "POST",
        url: `${base}/tenants/{tenantId}/vms`,
        roles: "user+",
        description: "Desplegar una VM nueva desde plantilla",
        body: {
          name: "string (requerido)",
          clusterId: "string (requerido, ver catalog)",
          templateId: "string (requerido, ver catalog)",
          cpuCores: "number",
          sockets: "number",
          memoryMB: "number",
          vnicProfileId: "string (ver catalog)",
          os: "string",
          comment: "string",
          cloudInit: { ip: "string?", netmask: "string?", gateway: "string?", dns: "string?" },
        },
        example: `curl -X POST -H "X-API-Key: KEY" -H "Content-Type: application/json" -d '{"name":"web-01","clusterId":"...","templateId":"...","cpuCores":2,"memoryMB":2048}' ${base}/tenants/produccion/vms`,
      },
      vm_actions: {
        method: "POST",
        url: `${base}/tenants/{tenantId}/vms/{vmId}/actions`,
        roles: "start/stop/restart/run_once_cd: user+ · clone: admin+",
        description: "Operar una VM existente del tenant",
        body: { action: "start | stop | restart | run_once_cd | clone", cloneName: "string (solo clone)" },
      },
      delete_vm: {
        method: "DELETE",
        url: `${base}/tenants/{tenantId}/vms/{vmId}`,
        roles: "admin+",
        description: "Eliminar una VM del tenant",
      },
      operation_jobs: {
        method: "GET",
        url: `${base}/tenants/{tenantId}/operation-jobs`,
        roles: "operator+",
        description: "Listar progreso durable de mutaciones del tenant; agregar /{jobId} para detalle",
      },
      catalog: {
        method: "GET",
        url: `${base}/tenants/{tenantId}/catalog`,
        roles: "operator+",
        description: "Clusters, plantillas, redes, vnic profiles y storage domains para construir un despliegue",
      },
      activity: {
        method: "GET",
        url: `${base}/activity`,
        roles: "operator+ (scope: tus tenants; superadmin: todos)",
        description: "Registro de operaciones: acciones del portal y via API, con usuario, origen, accion y estado",
      },
      tenant_activity: {
        method: "GET",
        url: `${base}/tenants/{tenantId}/activity`,
        roles: "operator+",
        description: "Actividades de un tenant especifico",
      },
    },
    authentication: {
      type: "API Key",
      header: "X-API-Key",
      example: `curl -H "X-API-Key: YOUR_KEY" ${base}/vms`,
    },
  });
}
