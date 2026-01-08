import { NextResponse } from "next/server";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

const buildWebsocketMeta = (baseUrl: string) => {
  const wsPath = process.env.OLVM_WEBSOCKET_PATH ?? "/ovirt-engine/websockify";
  try {
    const url = new URL(baseUrl);
    const protocol = url.protocol === "http:" ? "ws:" : "wss:";
    const host = url.hostname;
    const port = url.port ? `:${url.port}` : "";
    const origin = `${protocol}//${host}${port}`;
    return { wsUrl: `${origin}${wsPath}`, wsPath, engineHost: host };
  } catch {
    return { wsUrl: wsPath, wsPath, engineHost: undefined };
  }
};

const buildNovncUrl = (baseUrl: string, host?: string, port?: string | number, ticket?: string, title?: string) => {
  if (!host || !port) return null;
  try {
    const engine = new URL(baseUrl);
    engine.pathname = "/ovirt-engine/services/novnc-main.jsp";
    engine.searchParams.set("host", host);
    engine.searchParams.set("port", String(port));
    engine.searchParams.set("title", title ?? "Console");
    if (ticket) {
      engine.searchParams.set("ticket", ticket);
      engine.searchParams.set("password", ticket);
    }
    return engine.toString();
  } catch {
    return null;
  }
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
    const tenant = getTenantById(tenantId);
    const ws = buildWebsocketMeta(tenant.baseUrl);
    const novncUrl = buildNovncUrl(
      tenant.baseUrl,
      info.host,
      info.tlsPort ?? info.port,
      info.ticket,
      `VM-${vmId}`,
    );
    return NextResponse.json({
      ...info,
      websocket: ws,
      novncUrl,
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
