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
    const target = url.searchParams.get("target");
    const insecure = url.searchParams.get("insecure") === "1";

    if (!target) {
      client.close(1011, "Missing target");
      return;
    }

    let upstream: WebSocket | null = null;
    try {
      upstream = new WebSocket(target, {
        rejectUnauthorized: !(insecure || allowInsecureDefault),
        ca: upstreamCa,
      });
    } catch (err) {
      client.close(1011, `Failed to connect upstream: ${(err as Error).message}`);
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

    upstream.on("open", () => {
      client.on("message", (data) => upstream?.send(data));
      client.on("close", (code, reason) => closeBoth(code, reason?.toString()));
      client.on("error", () => closeBoth(1011, "Client socket error"));
      upstream?.on("message", (data) => client.send(data));
      upstream?.on("close", (code, reason) => closeBoth(code, reason?.toString()));
      upstream?.on("error", () => closeBoth(1011, "Upstream socket error"));
    });
  });

  httpServer.listen(port, "0.0.0.0");

  return { port };
};
