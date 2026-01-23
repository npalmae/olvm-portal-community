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
    const defaultProtocol = url.protocol === "http:" ? "ws:" : "wss:";
    const host = url.hostname;
    const basePort = url.port || undefined;
    const portCandidates = Array.from(
      new Set(
        [
          basePort,
          defaultProtocol === "wss:" ? "443" : "80",
          "6100",
          "6101",
        ].filter(Boolean),
      ),
    );

    const protocols =
      defaultProtocol === "wss:" ? ["wss:", "ws:"] : ["ws:", "wss:"];

    const wsUrls: string[] = [];
    for (const proto of protocols) {
      for (const p of paths) {
        for (const pc of portCandidates) {
          const portSuffix = pc ? `:${pc}` : "";
          wsUrls.push(`${proto}//${host}${portSuffix}${p}`);
        }
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
    const rawWsPath = (info as any)?.websocket?.wsPath as string | undefined;
    if (rawWsUrl) {
      candidateUrls.push(rawWsUrl);
    }
    if (!rawWsUrl && rawWsPath && wsMeta.engineHost) {
      const proto = tenant.baseUrl.startsWith("https") ? "wss" : "ws";
      const port = wsMeta.port ?? url.port;
      const portSuffix = port ? `:${port}` : "";
      candidateUrls.push(`${proto}://${wsMeta.engineHost}${portSuffix}${rawWsPath}`);
    }

    const novncUrl = (info as any)?.novncUrl as string | undefined;
    if (novncUrl) {
      candidateUrls.push(novncUrl);
    }

    if (wsMeta?.wsUrls?.length) {
      candidateUrls.push(...wsMeta.wsUrls);
    }

    const targets: string[] = [];
    const hostParam = info.host ?? wsMeta.engineHost ?? "";
    const portParam = (info.tlsPort ?? info.port ?? "").toString();
    const ticketRaw = info.ticket ?? "";
    const ticketEncoded = encodeURIComponent(ticketRaw);
    const hostEncoded = encodeURIComponent(hostParam);
    const portEncoded = encodeURIComponent(portParam);
    const tcpCandidates: string[] = [];
    if (hostParam && portParam) {
      tcpCandidates.push(`tcp://${hostParam}:${portParam}`);
    }
    if (info.proxyTicket?.host && info.proxyTicket?.port) {
      tcpCandidates.push(`tcp://${info.proxyTicket.host}:${info.proxyTicket.port}`);
    }
    const buildVariants = (base: string) => {
      const hasQuery = base.includes("?");
      const baseClean = base.replace(/\?$/, "");
      const sep = hasQuery ? "&" : "?";
      // ticket only (encoded y raw)
      targets.push(`${baseClean}${sep}ticket=${ticketEncoded}`);
      targets.push(`${baseClean}${sep}ticket=${ticketRaw}`);
      // host/port/ticket (encoded y raw)
      targets.push(
        `${baseClean}${sep}host=${hostEncoded}&port=${portEncoded}&ticket=${ticketEncoded}`,
      );
      targets.push(
        `${baseClean}${sep}host=${hostParam}&port=${portParam}&ticket=${ticketRaw}`,
      );
    };

    const wsCandidates = candidateUrls.filter(Boolean);

    targets.push(...tcpCandidates);

    for (const urlCandidate of wsCandidates) {
      const lower = urlCandidate.toLowerCase();
      const looksComplete =
        lower.startsWith("ws") &&
        (lower.includes("ticket=") || lower.includes("host=") || lower.includes("port="));
      if (looksComplete) {
        targets.push(urlCandidate);
      } else {
        buildVariants(urlCandidate);
      }
    }

    const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));

    if (uniqueTargets.length === 0) {
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
    const proxyUrl = `${isSecure ? "wss" : "ws"}://${origin.hostname}:${port}/?targets=${encodeURIComponent(uniqueTargets.join("|"))}&insecure=${tenant.allowInsecure ? "1" : "0"}`;

    return NextResponse.json({
      proxyWsUrl: proxyUrl,
      targetWsUrl: uniqueTargets[0],
      targets: uniqueTargets,
    });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
