import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();

  const base = new URL(request.url).origin + "/api/v1";

  return NextResponse.json({
    api: "OLVM Portal Read-Only API",
    version: "1.0",
    authenticatedAs: ctx.userEmail,
    scope: ctx.globalRole === "superadmin" ? "all tenants" : `tenants: ${ctx.tenantIds.join(", ") || "none"}`,
    endpoints: {
      overview: {
        method: "GET",
        url: `${base}/overview`,
        description: "Resumen de todos los tenants accesibles: VMs, CPU, RAM, storage",
        response: { tenants: [{ tenantId: "string", tenantName: "string", vmCount: "number", vmsUp: "number", totalCpuCores: "number", totalMemoryMB: "number", storage: "array" }] },
      },
      vms: {
        method: "GET",
        url: `${base}/vms`,
        description: "Listado completo de VMs con recursos, status, métricas y tags",
        response: { total: "number", up: "number", down: "number", vms: [{ id: "string", name: "string", status: "string", tenantName: "string", cpuCores: "number", memoryMB: "number", os: "string", ip: "string", metrics: "object" }] },
      },
      storage: {
        method: "GET",
        url: `${base}/storage`,
        description: "Uso de storage domains por tenant con porcentaje de uso",
        response: { tenants: [{ tenantId: "string", tenantName: "string", storageDomains: [{ name: "string", totalGB: "number", usedGB: "number", availableGB: "number", usagePercent: "number" }] }] },
      },
      tenant_detail: {
        method: "GET",
        url: `${base}/tenants/{tenantId}`,
        description: "Detalle de VMs y storage de un tenant específico",
        params: { tenantId: "ID del tenant a consultar" },
        response: { tenantId: "string", vms: "array", summary: "object", storageDomains: "array" },
      },
    },
    authentication: {
      type: "API Key",
      header: "X-API-Key",
      example: `curl -H "X-API-Key: YOUR_KEY" ${base}/vms`,
    },
  });
}
