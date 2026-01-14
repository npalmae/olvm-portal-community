import { NextResponse } from "next/server";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";
import { ensureConsoleProxy } from "@/lib/wsProxy";

export const dynamic = "force-dynamic";

const buildWebsocketCandidates = (baseUrl: string) => {
  const envPathRaw = process.env.OLVM_WEBSOCKET_PATH;
  const envPaths = envPathRaw
    ? envPathRaw.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  const derivedPaths = (() => {
    try {
      const u = new URL(baseUrl);
      const hasOvirt = u.pathname.includes("/ovirt-engine");
      return hasOvirt
        ? ["/ovirt-engine/websockify", "/ovirt-engine/websocket", "/websockify", "/websocket"]
        : ["/websockify", "/websocket"];
    } catch {
      return ["/websockify", "/websocket"];
    }
  })();

  const paths = Array.from(new Set([...envPaths, ...derivedPaths]));

  try {
    const url = new URL(baseUrl);
    const protocol = url.protocol === "http:" ? "ws:" : "wss:";
    const host = url.hostname;
    const port = url.port ? `:${url.port}` : "";
    const origin = `${protocol}//${host}${port}`;
    const wsUrls = paths.map((p) => `${origin}${p}`);
    return { wsUrls, engineHost: host };
  } catch {
    return { wsUrls: paths, engineHost: undefined };
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

    const wsMeta = info.websocket ?? buildWebsocketCandidates(tenant.baseUrl);
    if (!wsMeta?.wsUrls?.length) {
      return NextResponse.json(
        { error: "Falta wsUrl del engine para crear proxy" },
        { status: 502 },
      );
    }

    const targets = wsMeta.wsUrls.map(
      (wsUrl) =>
        `${wsUrl}?host=${info.host ?? wsMeta.engineHost ?? ""}&port=${info.tlsPort ?? info.port ?? ""}&ticket=${info.ticket ?? ""}`,
    );
    const { port } = ensureConsoleProxy({
      ca: tenant.caCert,
      allowInsecure: tenant.allowInsecure,
    });
    const origin = new URL(request.url);
    const isSecure = origin.protocol === "https:";
    const proxyUrl = `${isSecure ? "wss" : "ws"}://${origin.hostname}:${port}/?targets=${encodeURIComponent(targets.join("|"))}&insecure=${tenant.allowInsecure ? "1" : "0"}`;

    return NextResponse.json({
      proxyWsUrl: proxyUrl,
      targetWsUrl: targets[0],
    });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
