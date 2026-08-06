import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { getTenants } from "@/lib/config";
import { fetchVms, fetchStorageDomains } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();

  try {
    const allTenants = await getTenants();
    const allowed = ctx.globalRole === "superadmin"
      ? allTenants
      : allTenants.filter((t) => ctx.tenantIds.includes(t.id));

    const results = await Promise.all(
      allowed.map(async (t) => {
        try {
          const [vms, storage] = await Promise.all([
            fetchVms(t.id).catch(() => []),
            fetchStorageDomains(t.id).catch(() => []),
          ]);
          return {
            tenantId: t.id,
            tenantName: t.name,
            vmCount: vms.length,
            vmsUp: vms.filter((v) => v.status?.toLowerCase() === "up").length,
            totalCpuCores: vms.reduce((sum, v) => sum + (v.cpuCores ?? 0), 0),
            totalMemoryMB: vms.reduce((sum, v) => sum + (v.memoryMB ?? 0), 0),
            storage: storage.map((s) => ({
              name: s.name, type: s.type, status: s.status,
              totalGB: s.totalGB, usedGB: s.usedGB, availableGB: s.availableGB,
            })),
          };
        } catch {
          return { tenantId: t.id, tenantName: t.name, error: "Failed to fetch" };
        }
      }),
    );
    return NextResponse.json({ tenants: results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
