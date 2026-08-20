import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import {
  fetchClusters,
  fetchNetworks,
  fetchStorageDomains,
  fetchTemplates,
  fetchVnicProfiles,
} from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string }> };

// GET /api/v1/tenants/{t}/catalog — opciones para construir un despliegue (operator+)
export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;

  try {
    const [clusters, templates, networks, vnicProfiles, storageDomains] = await Promise.all([
      fetchClusters(tenantId).catch(() => []),
      fetchTemplates(tenantId).catch(() => []),
      fetchNetworks(tenantId).catch(() => []),
      fetchVnicProfiles(tenantId).catch(() => []),
      fetchStorageDomains(tenantId).catch(() => []),
    ]);
    return NextResponse.json({ tenantId, clusters, templates, networks, vnicProfiles, storageDomains });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
