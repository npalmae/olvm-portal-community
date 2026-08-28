import crypto from "crypto";
import http from "http";
import net from "net";
import tls from "tls";
import { WebSocket, WebSocketServer } from "ws";

let server: WebSocketServer | null = null;
let proxyPort: number | null = null;

type ProxyOptions = {
  ca?: Buffer;
  allowInsecure?: boolean;
};

type ConsoleProxySession = ProxyOptions & {
  targets: string[];
  expiresAt: number;
};

const sessionTtlMs = 60_000;
const maxSessions = 1_000;
const sessions = new Map<string, ConsoleProxySession>();

const cleanupExpiredSessions = () => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
};

const validateTarget = (target: string) => {
  const parsed = new URL(target);
  if (!parsed.hostname || !["tcp:", "tls:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("Destino de consola inválido");
  }
  return target;
};

// Browser clients receive only this short-lived opaque capability. Targets and
// TLS settings remain in the server process and cannot be overridden by a URL.
export const createConsoleProxySession = (options: ProxyOptions & { targets: string[] }) => {
  cleanupExpiredSessions();
  if (!options.targets.length || options.targets.length > 8) {
    throw new Error("Destinos de consola inválidos");
  }
  if (sessions.size >= maxSessions) throw new Error("Demasiadas sesiones de consola pendientes");

  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, {
    targets: options.targets.map(validateTarget),
    ca: options.ca,
    allowInsecure: options.allowInsecure === true,
    expiresAt: Date.now() + sessionTtlMs,
  });
  return token;
};

const consumeConsoleProxySession = (token: string) => {
  cleanupExpiredSessions();
  const session = sessions.get(token);
  sessions.delete(token);
  return session;
};

const asBuffer = (data: WebSocket.RawData) => {
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
};

const closeClient = (client: WebSocket, reason: string) => {
  if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
    client.close(1011, reason);
  }
};

const connectClientToTarget = (
  client: WebSocket,
  session: ConsoleProxySession,
  targetIndex = 0,
  attempt = 0,
) => {
  if (client.readyState !== WebSocket.OPEN) return;
  const target = session.targets[targetIndex];
  if (!target) {
    closeClient(client, "Console upstream unavailable");
    return;
  }

  const tryNext = () => {
    if (attempt < 14) {
      setTimeout(() => connectClientToTarget(client, session, targetIndex, attempt + 1), 1_000);
      return;
    }
    connectClientToTarget(client, session, targetIndex + 1);
  };

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    tryNext();
    return;
  }

  if (parsed.protocol === "tcp:" || parsed.protocol === "tls:") {
    const port = Number(parsed.port) || 5900;
    const isTls = parsed.protocol === "tls:";
    const socket = isTls
      ? tls.connect({
          host: parsed.hostname,
          port,
          servername: parsed.hostname,
          rejectUnauthorized: !session.allowInsecure,
          ca: session.ca,
        })
      : net.createConnection({ host: parsed.hostname, port });
    let established = false;

    const onEarlyError = () => {
      if (!established) tryNext();
    };
    socket.once("error", onEarlyError);
    socket.once(isTls ? "secureConnect" : "connect", () => {
      established = true;
      socket.off("error", onEarlyError);
      client.on("message", (data) => socket.write(asBuffer(data)));
      client.once("close", () => socket.destroy());
      client.once("error", () => socket.destroy());
      socket.on("data", (data) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
      });
      socket.once("close", () => closeClient(client, "Console connection closed"));
      socket.once("error", () => closeClient(client, "Console connection failed"));
    });
    return;
  }

  const upstream = new WebSocket(target, ["binary"], {
    rejectUnauthorized: !session.allowInsecure,
    ca: session.ca,
  });
  let established = false;
  const onEarlyError = () => {
    if (!established) tryNext();
  };
  upstream.once("error", onEarlyError);
  upstream.once("open", () => {
    established = true;
    upstream.off("error", onEarlyError);
    client.on("message", (data) => upstream.send(data));
    client.once("close", () => upstream.close());
    client.once("error", () => upstream.close());
    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
    upstream.once("close", () => closeClient(client, "Console connection closed"));
    upstream.once("error", () => closeClient(client, "Console connection failed"));
  });
};

export const ensureConsoleProxy = async () => {
  if (server && proxyPort) return { port: proxyPort };

  process.env.WS_NO_BUFFER_UTIL = "1";
  process.env.WS_NO_UTF8_VALIDATE = "1";

  const desiredPort = Number(process.env.CONSOLE_PROXY_PORT ?? 3010);
  const httpServer = http.createServer((_, response) => {
    response.writeHead(404);
    response.end();
  });
  server = new WebSocketServer({ server: httpServer, perMessageDeflate: false });

  server.on("connection", (client, req) => {
    const url = new URL(req.url ?? "/", "ws://localhost");
    const token = url.searchParams.get("session");
    const hasOnlySession = [...url.searchParams.keys()].every((key) => key === "session")
      && url.searchParams.getAll("session").length === 1;
    if (!token || !hasOnlySession) {
      client.close(1008, "Invalid console session");
      return;
    }

    const session = consumeConsoleProxySession(token);
    if (!session) {
      client.close(1008, "Expired console session");
      return;
    }
    connectClientToTarget(client, session);
  });

  const startListening = (portToTry: number): Promise<number> =>
    new Promise((resolve, reject) => {
      httpServer.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          startListening(0).then(resolve).catch(reject);
          return;
        }
        reject(error);
      });
      httpServer.listen(portToTry, "127.0.0.1", () => {
        const address = httpServer.address();
        proxyPort = typeof address === "object" && address ? address.port : portToTry;
        resolve(proxyPort);
      });
    });

  return { port: await startListening(desiredPort) };
};
