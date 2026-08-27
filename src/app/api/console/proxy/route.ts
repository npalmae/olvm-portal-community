import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { fetchVmConsoleInfo } from "@/lib/olvmClient";
import { enforceVmTagPolicy } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";
import { ensureConsoleProxy } from "@/lib/wsProxy";

export const dynamic = "force-dynamic";

const getExternalOrigin = (request: Request) => {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
};

const getEngineMeta = (baseUrl: string) => {
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
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "user");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const tenant = await getTenantById(tenantId);
    const providedTicket = url.searchParams.get("ticket") ?? undefined;
    const consoleId = url.searchParams.get("consoleId") ?? undefined;
    const info = await fetchVmConsoleInfo(tenantId, vmId, protocol, {
      ticket: providedTicket,
      consoleId,
      issueTicket: !!providedTicket,
    });

    const engineMeta = getEngineMeta(tenant.baseUrl);

    const candidateUrls: string[] = [];

    const rawWsUrl = (info as any)?.websocket?.wsUrl as string | undefined;
    const rawWsPath = (info as any)?.websocket?.wsPath as string | undefined;
    const proxyTicketValue =
      (info as any)?.proxyTicket?.value as string | undefined;
    const engineWsProtocol = tenant.baseUrl.startsWith("https") ? "wss" : "ws";

    const appendProxyTicket = (wsUrl: string) => {
      if (!proxyTicketValue) return wsUrl;
      const sep = wsUrl.includes("?") ? "&" : "?";
      return `${wsUrl}${sep}ticket=${encodeURIComponent(proxyTicketValue)}`;
    };

    const isLocalProxyUrl = (value: string) =>
      value.includes("localhost:3010") || value.includes("127.0.0.1:3010");

    // OLVM/oracle OLVM sirve la noVNC funcional a traves de su propio
    // websockify TLS en 6100, usando el proxyticket como path de la URL WS.
    // Cuando este valor existe, lo priorizamos por sobre el VNC TCP directo.
    if (proxyTicketValue && engineMeta.engineHost) {
      // OLVM/noVNC usa el proxyticket crudo como path del websocket.
      // Lo agregamos como candidato aguas arriba, pero manteniendo el browser
      // conectado a nuestro proxy local para evitar validaciones de Origin
      // y replicar el mismo tunel server-side que ya usamos para VNC.
      const directWsUrl = `${engineWsProtocol}://${engineMeta.engineHost}:6100/${proxyTicketValue}`;
      candidateUrls.push(directWsUrl);
    }

    if (rawWsUrl && !isLocalProxyUrl(rawWsUrl)) {
      candidateUrls.push(appendProxyTicket(rawWsUrl));
    }
    if (!rawWsUrl && rawWsPath && engineMeta.engineHost) {
      const proto = tenant.baseUrl.startsWith("https") ? "wss" : "ws";
      const basePort = (() => {
        try {
          return new URL(tenant.baseUrl).port;
        } catch {
          return "";
        }
      })();
      const port = basePort || url.port;
      const portSuffix = port ? `:${port}` : "";
      candidateUrls.push(
        appendProxyTicket(
          `${proto}://${engineMeta.engineHost}${portSuffix}${rawWsPath}`,
        ),
      );
    }

    const novncUrl = (info as any)?.novncUrl as string | undefined;
    if (novncUrl) {
      candidateUrls.push(appendProxyTicket(novncUrl));
    }

    const hostParam = info.host ?? engineMeta.engineHost ?? "";
    const portParam = (info.tlsPort ?? info.port ?? "").toString();
    const targets: string[] = [];

    // En este despliegue el VNC TCP directo ha sido el canal más estable
    // para la consola embebida; algunos websockets nativos del engine
    // abren pero no siempre entregan framebuffer util. Por eso priorizamos
    // el destino TCP y dejamos los WS del engine como fallback.
    if (hostParam && portParam) {
      targets.push(`tcp://${hostParam}:${portParam}`);
    }

    // Fallback a los endpoints WebSocket nativos del engine.
    targets.push(...candidateUrls.filter(Boolean));

    const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));

    if (uniqueTargets.length === 0) {
      return NextResponse.json(
        { error: "Falta wsUrl del engine para crear proxy" },
        { status: 502 },
      );
    }

    const { port } = await ensureConsoleProxy({
      ca: tenant.caCert,
      allowInsecure: tenant.allowInsecure,
    });
    const externalOrigin = getExternalOrigin(request);
    const externalUrl = new URL(externalOrigin);
    const proxyPath = process.env.CONSOLE_PROXY_PUBLIC_PATH ?? "/console-proxy/";
    const normalizedProxyPath = proxyPath.endsWith("/") ? proxyPath : `${proxyPath}/`;
    const wsProtocol = externalUrl.protocol === "https:" ? "wss:" : "ws:";
    // El proxy WS escucha en su propio puerto (3010); se expone ese puerto
    // al navegador (salvo override vía CONSOLE_PROXY_PUBLIC_HOST_PORT para
    // despliegues con reverse proxy que mapeen /console-proxy/ al 3010).
    const proxyAuthority =
      process.env.CONSOLE_PROXY_PUBLIC_HOST_PORT ||
      `${externalUrl.hostname}:${port}`;
    const proxyUrl = `${wsProtocol}//${proxyAuthority}${normalizedProxyPath}?targets=${encodeURIComponent(uniqueTargets.join("|"))}&insecure=${tenant.allowInsecure ? "1" : "0"}`;

    return NextResponse.json({
      proxyWsUrl: proxyUrl,
      proxyPort: port,
      targetWsUrl: uniqueTargets[0],
      targets: uniqueTargets,
    });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
