import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/setupState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getSetupStatus();
  return NextResponse.json(status);
}
