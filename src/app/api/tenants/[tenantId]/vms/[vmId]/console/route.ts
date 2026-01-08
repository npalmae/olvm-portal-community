import { NextResponse } from "next/server";
import { fetchVmConsoleFile } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  const url = new URL(request.url);
  const protocolParam = url.searchParams.get("protocol");
  const protocol =
    protocolParam === "vnc" || protocolParam === "spice"
      ? (protocolParam as "spice" | "vnc")
      : "vnc";

  try {
    const vv = await fetchVmConsoleFile(tenantId, vmId, protocol);
    const filename = `${vmId}-${protocol}.vv`;
    return new Response(vv, {
      headers: {
        "content-type": "application/x-virt-viewer",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
