import http from "http";
import { WebSocket, WebSocketServer } from "ws";

let server: WebSocketServer | null = null;
let proxyPort: number | null = null;
let upstreamCa: Buffer | undefined;
let allowInsecureDefault = false;

type ProxyOptions = {
  ca?: Buffer;
  allowInsecure?: boolean;
};

export const ensureConsoleProxy = (options?: ProxyOptions) => {
  if (server) {
    return { port: proxyPort as number };
  }

  upstreamCa = options?.ca;
  allowInsecureDefault = options?.allowInsecure ?? false;

  const port = Number(process.env.CONSOLE_PROXY_PORT ?? 3010);
  const httpServer = http.createServer();
  server = new WebSocketServer({ server: httpServer });
  proxyPort = port;

  server.on("connection", (client, req) => {
    const url = new URL(req.url ?? "/", "ws://localhost");
    const targetsParam = url.searchParams.get("targets");
    const targets = targetsParam
      ? targetsParam.split("|").map((t) => decodeURIComponent(t)).filter(Boolean)
      : [];
    const targetSingle = url.searchParams.get("target");
    if (targetSingle) targets.push(targetSingle);
    const target = targets[0];
    const insecure = url.searchParams.get("insecure") === "1";

    if (!target) {
      client.close(1011, "Missing target");
      return;
    }

    const closeBoth = (code?: number, reason?: string) => {
      try {
        client.close(code, reason);
      } catch {
        // ignore
      }
      try {
        upstream?.close(code, reason);
      } catch {
        // ignore
      }
    };

    let upstream: WebSocket | null = null;
    let currentIndex = 0;

    const tryConnect = () => {
      const currentTarget = targets[currentIndex];
      if (!currentTarget) {
        closeBoth(1011, "No upstream target available");
        return;
      }
      try {
        upstream = new WebSocket(currentTarget, {
          rejectUnauthorized: !(insecure || allowInsecureDefault),
          ca: upstreamCa,
        });
      } catch {
        currentIndex += 1;
        setTimeout(tryConnect, 10);
        return;
      }

      upstream.on("open", () => {
        client.on("message", (data) => upstream?.send(data));
        client.on("close", (code, reason) => closeBoth(code, reason?.toString()));
        client.on("error", () => closeBoth(1011, "Client socket error"));
        upstream?.on("message", (data) => client.send(data));
        upstream?.on("close", (code, reason) => closeBoth(code, reason?.toString()));
        upstream?.on("error", () => closeBoth(1011, "Upstream socket error"));
      });

      upstream.on("error", () => {
        currentIndex += 1;
        tryConnect();
      });
    };

    tryConnect();
  });

  httpServer.listen(port, "0.0.0.0");

  return { port };
};
