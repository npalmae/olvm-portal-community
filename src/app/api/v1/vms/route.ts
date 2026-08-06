import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { getTenants } from "@/lib/config";
import { fetchVms } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();

  try {
    const allTenants = await getTenants();
    const allowed = ctx.globalRole === "superadmin"
      ? allTenants
      : allTenants.filter((t) => ctx.tenantIds.includes(t.id));

    const allVms = await Promise.all(
      allowed.map(async (t) => {
        try {
          const vms = await fetchVms(t.id);
          return vms.map((v) => ({
            id: v.id, name: v.name, status: v.status,
            tenantId: t.id, tenantName: t.name,
            cluster: v.cluster, template: v.template, host: v.host,
            cpuCores: v.cpuCores ?? 0, sockets: v.sockets ?? 0,
            memoryMB: v.memoryMB ?? 0, os: v.os, ip: v.ip,
            tags: v.tags, metrics: v.metrics,
          }));
        } catch { return []; }
      }),
    );
    const flat = allVms.flat();
    return NextResponse.json({
      total: flat.length,
      up: flat.filter((v) => v.status?.toLowerCase() === "up").length,
      down: flat.filter((v) => v.status?.toLowerCase() !== "up").length,
      vms: flat,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
