const http = require("http");
const net = require("net");

const NEXT_PORT = 3001;
const WS_PORT = 3010;
const LISTEN_PORT = 3000;

const server = http.createServer((req, res) => {
  const proxy = http.request(
    {
      hostname: "localhost",
      port: NEXT_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (pRes) => {
      res.writeHead(pRes.statusCode || 200, pRes.headers);
      pRes.pipe(res);
    }
  );
  proxy.on("error", (err) => {
    console.error("[proxy] HTTP error:", err.message);
    res.statusCode = 502;
    res.end("Bad Gateway");
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const isConsole = (req.url || "").startsWith("/console-proxy/");
  const targetPort = isConsole ? WS_PORT : NEXT_PORT;

  console.log("[proxy] upgrade", {
    url: req.url?.substring(0, 100),
    target: targetPort,
    headers: Object.keys(req.headers).join(","),
  });

  const proxy = net.connect(targetPort, "localhost", () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") {
        raw += `Host: localhost:${targetPort}\r\n`;
      } else {
        raw += `${key}: ${value}\r\n`;
      }
    }
    raw += "\r\n";
    proxy.write(raw);
    if (head && head.length) proxy.write(head);
    socket.pipe(proxy);
    proxy.pipe(socket);
  });
  proxy.on("error", (err) => {
    console.error("[proxy] WS connect error:", err.message, "port:", targetPort);
    socket.destroy();
  });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`[proxy] Listening on :${LISTEN_PORT} → HTTP:${NEXT_PORT} WS:${WS_PORT}`);
});
