import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { getTenants } from "@/lib/config";
import { fetchStorageDomains } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!checkApiKey(request)) return unauthorizedResponse();

  try {
    const tenants = getTenants();
    const allStorage = await Promise.all(
      tenants.map(async (t) => {
        try {
          const sds = await fetchStorageDomains(t.id);
          return {
            tenantId: t.id,
            tenantName: t.name,
            storageDomains: sds.map((s) => ({
              id: s.id,
              name: s.name,
              type: s.type,
              status: s.status,
              totalGB: s.totalGB,
              usedGB: s.usedGB,
              availableGB: s.availableGB,
              usagePercent: s.totalGB > 0 ? Math.round((s.usedGB / s.totalGB) * 100) : 0,
            })),
          };
        } catch {
          return { tenantId: t.id, tenantName: t.name, storageDomains: [] };
        }
      }),
    );
    return NextResponse.json({ tenants: allStorage });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
