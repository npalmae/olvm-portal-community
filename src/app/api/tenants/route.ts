import { NextResponse } from "next/server";
import { getTenants } from "@/lib/config";
import { auth } from "@/auth";
import { getAccessibleTenantIds, isPlatformSuperadmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = (await getTenants()).map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    baseUrl: tenant.baseUrl,
    allowInsecure: tenant.allowInsecure,
    brandName: tenant.brandName,
    brandLogoUrl: tenant.brandLogoUrl,
  }));

  if (isPlatformSuperadmin(session.user)) {
    return NextResponse.json(tenants);
  }

  const accessibleTenantIds = new Set(getAccessibleTenantIds(session.user));
  const visibleTenants = tenants.filter((tenant) =>
    accessibleTenantIds.has(tenant.id),
  );

  if (!visibleTenants.length) {
    return NextResponse.json(
      { error: "Tenant no configurado para este usuario" },
      { status: 404 },
    );
  }

  return NextResponse.json(visibleTenants);
}
