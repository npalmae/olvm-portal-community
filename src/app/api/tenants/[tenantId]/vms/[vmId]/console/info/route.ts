import { NextResponse } from "next/server";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  const url = new URL(request.url);
  const protocolParam = url.searchParams.get("protocol");
  const protocol =
    protocolParam === "spice" || protocolParam === "vnc"
      ? (protocolParam as "spice" | "vnc")
      : "vnc";

  try {
    const info = await fetchVmConsoleInfo(tenantId, vmId, protocol);
    const host = info.host ?? info.websocket?.engineHost;
    const port = info.tlsPort ?? info.port;
    let novncUrl: string | undefined;

    if (info.websocket?.wsUrl && host && port && info.ticket) {
      const base = info.websocket.wsUrl.replace(/\?$/, "");
      const sep = base.includes("?") ? "&" : "?";
      novncUrl = `${base}${sep}host=${encodeURIComponent(host)}&port=${encodeURIComponent(port.toString())}&ticket=${encodeURIComponent(info.ticket)}`;
    }

    return NextResponse.json({
      ...info,
      host,
      port,
      novncUrl,
      consoleId: info.consoleId,
    });
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status = lower.includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
