import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/setupState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { setupComplete } = await getSetupStatus();
  return NextResponse.json(
    { setupComplete },
    { headers: { "Cache-Control": "no-store" } },
  );
}
