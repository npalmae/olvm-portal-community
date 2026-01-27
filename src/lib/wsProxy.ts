import http from "http";
import net from "net";
import tls from "tls";
import { WebSocket, WebSocketServer } from "ws";

let server: WebSocketServer | null = null;
let proxyPort: number | null = null;
let upstreamCa: Buffer | undefined;
let allowInsecureDefault = false;

type ProxyOptions = {
  ca?: Buffer;
  allowInsecure?: boolean;
};

export const ensureConsoleProxy = async (options?: ProxyOptions) => {
  if (server && proxyPort) {
    return { port: proxyPort };
  }

  // Desactiva extensiones nativas de ws para evitar dependencias de bufferutil/utf-8-validate
  process.env.WS_NO_BUFFER_UTIL = "1";
  process.env.WS_NO_UTF8_VALIDATE = "1";

  upstreamCa = options?.ca;
  allowInsecureDefault = options?.allowInsecure ?? false;

  const desiredPort = Number(process.env.CONSOLE_PROXY_PORT ?? 3010);
  const httpServer = http.createServer();
  server = new WebSocketServer({ server: httpServer });

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

    console.log("[ws-proxy] new client", {
      url: req.url,
      targets,
      insecure,
      allowInsecureDefault,
    });

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

    const tryTcpConnect = (target: string) => {
      let hostname: string | undefined;
      let port: number | undefined;
      const isTls = target.startsWith("tls://");

      try {
        const parsed = new URL(target);
        hostname = parsed.hostname;
        port = Number(parsed.port) || 5900;
      } catch {
        currentIndex += 1;
        setTimeout(tryConnect, 10);
        return;
      }

      console.log("[ws-proxy] try TCP", {
        target,
        hostname,
        port,
        index: currentIndex,
        tls: isTls,
      });

      const socketFactory = isTls
        ? () =>
            tls.connect(
              {
                host: hostname,
                port,
                rejectUnauthorized: !(insecure || allowInsecureDefault),
                ca: upstreamCa,
              },
              () => {
                console.log("[ws-proxy] tls connected", {
                  target,
                  index: currentIndex,
                });
              },
            )
        : () =>
            net.createConnection({ host: hostname, port }, () => {
              console.log("[ws-proxy] tcp connected", {
                target,
                index: currentIndex,
              });
            });

      const socket = socketFactory();

      socket.on("connect", () => {
        client.on("message", (data) => socket.write(data));
        client.on("close", (code, reason) => closeBoth(code, reason?.toString()));
        client.on("error", () => closeBoth(1011, "Client socket error"));

        socket.on("data", (data) => {
          try {
            client.send(data);
          } catch {
            closeBoth(1011, "Forwarding error");
          }
        });
        socket.on("close", (code) =>
          closeBoth(code ?? 1011, isTls ? "TLS upstream closed" : "TCP upstream closed"),
        );
        socket.on("error", () => {
          console.warn("[ws-proxy] tcp/tls error", { target, index: currentIndex });
          currentIndex += 1;
          setTimeout(tryConnect, 10);
        });
      });

      socket.on("error", () => {
        currentIndex += 1;
        setTimeout(tryConnect, 10);
      });
    };

    const tryConnect = () => {
      const currentTarget = targets[currentIndex];
      if (!currentTarget) {
        closeBoth(1011, "No upstream target available");
        return;
      }

      console.log("[ws-proxy] try target", { currentTarget, index: currentIndex });

      if (currentTarget.startsWith("tcp://")) {
        tryTcpConnect(currentTarget);
        return;
      }

      try {
        upstream = new WebSocket(currentTarget, {
          rejectUnauthorized: !(insecure || allowInsecureDefault),
          ca: upstreamCa,
        });
      } catch (err) {
        console.warn("[ws-proxy] ws constructor failed", { currentTarget, err });
        currentIndex += 1;
        setTimeout(tryConnect, 10);
        return;
      }

      upstream.on("open", () => {
        console.log("[ws-proxy] ws connected", { currentTarget, index: currentIndex });
        client.on("message", (data) => upstream?.send(data));
        client.on("close", (code, reason) => closeBoth(code, reason?.toString()));
        client.on("error", () => closeBoth(1011, "Client socket error"));
        upstream?.on("message", (data) => client.send(data));
        upstream?.on("close", (code, reason) => closeBoth(code, reason?.toString()));
        upstream?.on("error", () => closeBoth(1011, "Upstream socket error"));
      });

      upstream.on("error", () => {
        console.warn("[ws-proxy] ws error", { currentTarget, index: currentIndex });
        currentIndex += 1;
        setTimeout(tryConnect, 10);
      });
    };

    tryConnect();
  });

  const startListening = (portToTry: number): Promise<number> =>
    new Promise((resolve, reject) => {
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          // Si el puerto está ocupado, pide uno libre al SO.
          startListening(0).then(resolve).catch(reject);
          return;
        }
        reject(err);
      });

      httpServer.listen(portToTry, "0.0.0.0", () => {
        const address = httpServer.address();
        proxyPort =
          typeof address === "object" && address ? address.port : portToTry;
        resolve(proxyPort as number);
      });
    });

  const port = await startListening(desiredPort);

  return { port };
};
