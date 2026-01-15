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
      const basePaths = [
        "/websockify",
        "/websocket",
        "/websocket-proxy",
        "/websocketproxy",
      ];
      const withEngine = [
        "/ovirt-engine/websockify",
        "/ovirt-engine/websocket",
        "/ovirt-engine/websocket-proxy",
        "/ovirt-engine/websocketproxy",
      ];
      if (hasOvirt) {
        return [...withEngine, ...basePaths];
      }
      return basePaths;
    } catch {
      return ["/websockify", "/websocket", "/websocket-proxy", "/websocketproxy"];
    }
  })();

  const paths = Array.from(new Set([...envPaths, ...derivedPaths]));

  try {
    const url = new URL(baseUrl);
    const protocol = url.protocol === "http:" ? "ws:" : "wss:";
    const host = url.hostname;
    const basePort = url.port || undefined;
    const portCandidates = Array.from(
      new Set(
        [
          basePort,
          protocol === "wss:" ? "443" : "80",
          "6100",
          "6101",
        ].filter(Boolean),
      ),
    );

    const wsUrls: string[] = [];
    for (const p of paths) {
      for (const pc of portCandidates) {
        const portSuffix = pc ? `:${pc}` : "";
        wsUrls.push(`${protocol}//${host}${portSuffix}${p}`);
      }
    }
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

    const candidateUrls: string[] = [];

    const rawWsUrl = (info as any)?.websocket?.wsUrl as string | undefined;
    if (rawWsUrl) {
      const lower = rawWsUrl.toLowerCase();
      const looksComplete =
        lower.includes("ticket=") || lower.includes("host=") || lower.includes("port=");
      candidateUrls.push(
        looksComplete
          ? rawWsUrl
          : `${rawWsUrl}?host=${info.host ?? wsMeta.engineHost ?? ""}&port=${info.tlsPort ?? info.port ?? ""}&ticket=${info.ticket ?? ""}`,
      );
    }

    const novncUrl = (info as any)?.novncUrl as string | undefined;
    if (novncUrl) {
      candidateUrls.push(novncUrl);
    }

    if (wsMeta?.wsUrls?.length) {
      candidateUrls.push(
        ...wsMeta.wsUrls.map(
          (wsUrl) =>
            `${wsUrl}?host=${info.host ?? wsMeta.engineHost ?? ""}&port=${info.tlsPort ?? info.port ?? ""}&ticket=${info.ticket ?? ""}`,
        ),
      );
    }

    const targets = Array.from(new Set(candidateUrls.filter(Boolean)));

    if (targets.length === 0) {
      return NextResponse.json(
        { error: "Falta wsUrl del engine para crear proxy" },
        { status: 502 },
      );
    }

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
      targets,
    });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
