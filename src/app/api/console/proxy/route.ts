import { NextResponse } from "next/server";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";
import { ensureConsoleProxy } from "@/lib/wsProxy";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const vmId = url.searchParams.get("vmId") ?? "";
  const protocol =
    url.searchParams.get("protocol") === "spice" ? "spice" : "vnc";

  if (!tenantId || !vmId) {
    return NextResponse.json(
      { error: "tenantId y vmId son obligatorios" },
      { status: 400 },
    );
  }

  try {
    const tenant = getTenantById(tenantId);
    const info = await fetchVmConsoleInfo(tenantId, vmId, protocol);

    const wsMeta = info.websocket ?? buildWebsocketMeta(tenant.baseUrl);
    if (!wsMeta?.wsUrl) {
      return NextResponse.json(
        { error: "Falta wsUrl del engine para crear proxy" },
        { status: 502 },
      );
    }

    const target = `${wsMeta.wsUrl}?host=${info.host ?? wsMeta.engineHost ?? ""}&port=${info.tlsPort ?? info.port ?? ""}&ticket=${info.ticket ?? ""}`;
    const { port } = ensureConsoleProxy();
    const origin = new URL(request.url);
    const isSecure = origin.protocol === "https:";
    const proxyUrl = `${isSecure ? "wss" : "ws"}://${origin.hostname}:${port}/?target=${encodeURIComponent(target)}&insecure=${tenant.allowInsecure ? "1" : "0"}`;

    return NextResponse.json({
      proxyWsUrl: proxyUrl,
      targetWsUrl: target,
    });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
