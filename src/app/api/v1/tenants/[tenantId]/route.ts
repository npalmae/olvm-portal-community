import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { fetchVms, fetchStorageDomains } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  const apiKey = await checkApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { tenantId } = await ctx.params;
  if (apiKey.globalRole !== "superadmin" && !apiKey.tenantIds.includes(tenantId)) {
    return NextResponse.json({ error: "Forbidden: tenant fuera del scope de la API key" }, { status: 403 });
  }
  try {
    const [vms, storage] = await Promise.all([
      fetchVms(tenantId),
      fetchStorageDomains(tenantId),
    ]);

    return NextResponse.json({
      tenantId,
      vms: vms.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status,
        cluster: v.cluster,
        host: v.host,
        cpuCores: v.cpuCores ?? 0,
        sockets: v.sockets ?? 0,
        memoryMB: v.memoryMB ?? 0,
        os: v.os,
        ip: v.ip,
        tags: v.tags,
        metrics: v.metrics,
      })),
      summary: {
        vmCount: vms.length,
        vmsUp: vms.filter((v) => v.status?.toLowerCase() === "up").length,
        vmsDown: vms.filter((v) => v.status?.toLowerCase() !== "up").length,
        totalCpuCores: vms.reduce((s, v) => s + (v.cpuCores ?? 0), 0),
        totalMemoryMB: vms.reduce((s, v) => s + (v.memoryMB ?? 0), 0),
        totalDiskGB: storage.reduce((s, sd) => s + sd.usedGB, 0),
      },
      storageDomains: storage.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        totalGB: s.totalGB,
        usedGB: s.usedGB,
        availableGB: s.availableGB,
        usagePercent: s.totalGB > 0 ? Math.round((s.usedGB / s.totalGB) * 100) : 0,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
