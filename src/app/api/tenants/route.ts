import { NextResponse } from "next/server";
import { getTenants } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const tenants = getTenants().map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    baseUrl: tenant.baseUrl,
    allowInsecure: tenant.allowInsecure,
  }));
  return NextResponse.json(tenants);
}
