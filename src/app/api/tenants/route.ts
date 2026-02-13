import { NextResponse } from "next/server";
import { getTenants } from "@/lib/config";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = getTenants().map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    baseUrl: tenant.baseUrl,
    allowInsecure: tenant.allowInsecure,
  }));

  if (session.user.role === "superadmin") {
    return NextResponse.json(tenants);
  }

  const currentTenant = tenants.find(
    (tenant) => tenant.id === session.user.tenantId,
  );

  if (!currentTenant) {
    return NextResponse.json(
      { error: "Tenant no configurado para este usuario" },
      { status: 404 },
    );
  }

  return NextResponse.json([currentTenant]);
}
