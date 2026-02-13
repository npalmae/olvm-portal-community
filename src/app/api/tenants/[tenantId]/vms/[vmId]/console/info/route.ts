import { NextResponse } from "next/server";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";
import { ensureConsoleProxy } from "@/lib/wsProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const withTicket = url.searchParams.get("withTicket") === "1";
    const info = await fetchVmConsoleInfo(tenantId, vmId, protocol, {
      issueTicket: withTicket,
    });
    const tenant = getTenantById(tenantId);
    const host = info.host;
    const port = info.tlsPort ?? info.port;
    
    // Crear proxy WebSocket local para evitar CORS
    let proxyUrl: string | undefined;
    if (host && port) {
      const { port: proxyPort } = await ensureConsoleProxy({
        ca: tenant.caCert,
        allowInsecure: tenant.allowInsecure,
      });
      const origin = new URL(request.url);
      const isSecure = origin.protocol === "https:";
      const target = `tcp://${host}:${port}`;
      proxyUrl = `${isSecure ? "wss" : "ws"}://${origin.hostname}:${proxyPort}/?targets=${encodeURIComponent(target)}&insecure=${tenant.allowInsecure ? "1" : "0"}`;
    }

    // URL para noVNC (usando el proxy local)
    let novncUrl: string | undefined;
    if (proxyUrl && info.ticket) {
      novncUrl = proxyUrl;
    }

    return NextResponse.json({
      ...info,
      host,
      port,
      ticket: info.ticket,
      consoleId: info.consoleId,
      websocket: {
        wsUrl: proxyUrl,
        engineHost: host,
      },
      novncUrl,
      proxyWsUrl: proxyUrl,
    });
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status = lower.includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
