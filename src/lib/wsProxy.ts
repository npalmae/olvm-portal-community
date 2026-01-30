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
  server = new WebSocketServer({
    server: httpServer,
    // Evita compresión de frames binarios (VNC es binario puro)
    perMessageDeflate: false,
  });

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
      console.log("[ws-proxy] closing", { code, reason });
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
    let upstreamEstablished = false;
    let clientSentFirst = false;
    let clientMsgCount = 0;
    let upstreamMsgCount = 0;

    const tryTcpConnect = (target: string) => {
      let hostname: string | undefined;
      let port: number | undefined;
      const isTls = target.startsWith("tls://");
      let firstChunkLogged = false;

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
        upstreamEstablished = true;
        client.on("message", (data) => {
          clientMsgCount += 1;
          if (!clientSentFirst || clientMsgCount <= 50) {
            console.log("[ws-proxy] client msg", {
              n: clientMsgCount,
              bytes: (data as Buffer).length ?? 0,
              index: currentIndex,
              target,
              hex: (data as Buffer).subarray(0, 32).toString("hex"),
            });
            clientSentFirst = true;
          }
          socket.write(data);
        });
        client.on("close", (code, reason) => {
          console.log("[ws-proxy] client closed", { code, reason: reason?.toString() });
          closeBoth(code, reason?.toString());
        });
        client.on("error", (err) => {
          console.warn("[ws-proxy] client error", err);
          closeBoth(1011, "Client socket error");
        });

        socket.on("data", (data) => {
          upstreamMsgCount += 1;
          if (!firstChunkLogged || upstreamMsgCount <= 50) {
            console.log("[ws-proxy] upstream data", {
              n: upstreamMsgCount,
              bytes: data.length,
              index: currentIndex,
              target,
              hex: data.subarray(0, 32).toString("hex"),
            });
            firstChunkLogged = true;
          }
          try {
            client.send(data, { binary: true });
          } catch {
            closeBoth(1011, "Forwarding error");
          }
        });
        socket.on("close", (code) => {
          console.log("[ws-proxy] upstream closed", {
            target,
            index: currentIndex,
            code,
          });
          const hasMore = Boolean(targets[currentIndex + 1]);
          if (!upstreamEstablished && hasMore) {
            currentIndex += 1;
            setTimeout(tryConnect, 10);
            return;
          }
          closeBoth(
            code ?? 1011,
            isTls ? "TLS upstream closed" : "TCP upstream closed",
          );
        });
        socket.on("error", (err) => {
          console.warn("[ws-proxy] tcp/tls error", { target, index: currentIndex, err });
          const hasMore = Boolean(targets[currentIndex + 1]);
          if (hasMore) {
            currentIndex += 1;
            setTimeout(tryConnect, 10);
            return;
          }
          closeBoth(1011, "TCP/TLS upstream error");
        });
      });

      socket.on("error", () => {
        const hasMore = Boolean(targets[currentIndex + 1]);
        if (hasMore) {
          currentIndex += 1;
          setTimeout(tryConnect, 10);
          return;
        }
        closeBoth(1011, "Socket error before connect");
      });
    };

    const tryConnect = () => {
      const currentTarget = targets[currentIndex];
      if (!currentTarget) {
        closeBoth(1011, "No upstream target available");
        return;
      }

      console.log("[ws-proxy] try target", { currentTarget, index: currentIndex });

      if (currentTarget.startsWith("tcp://") || currentTarget.startsWith("tls://")) {
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
        console.warn("[ws-proxy] listen error", err);
        reject(err);
      });

      try {
        httpServer.listen(portToTry, "0.0.0.0", () => {
          const address = httpServer.address();
          proxyPort =
            typeof address === "object" && address ? address.port : portToTry;
          resolve(proxyPort as number);
        });
      } catch (err) {
        reject(err);
      }
    });

  const port = await startListening(desiredPort);

  return { port };
};
