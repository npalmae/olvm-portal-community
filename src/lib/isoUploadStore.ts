import { resolveTenant, type TenantConfig } from "./config";
import { Agent as UndiciAgent } from "undici";

export type UploadSession = {
  tenant: TenantConfig;
  fileName: string;
  fileSize: number;
  storageDomainId: string;
  diskId: string;
  transferId: string;
  uploadUrl: string;
  receivedChunks: number;
  totalChunks: number;
  dispatcher: UndiciAgent;
};

const CHUNK_SIZE = 50 * 1024 * 1024;

const buildHeaders = (tenant: TenantConfig, extra?: Record<string, string>) => {
  const authHeader = tenant.token
    ? `Bearer ${tenant.token}`
    : `Basic ${Buffer.from(`${tenant.username}:${tenant.password}`, "utf-8").toString("base64")}`;
  return { Accept: "application/json", "Content-Type": "application/json", Authorization: authHeader, ...extra };
};

const doFetch = async (tenant: TenantConfig, path: string, init?: RequestInit & { dispatcher?: UndiciAgent }) => {
  const url = path.startsWith("http") ? path : `${tenant.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const dispatcher = init?.dispatcher ?? new UndiciAgent({ connect: { rejectUnauthorized: tenant.allowInsecure ?? false } });
  const res = await fetch(url, {
    ...init,
    cache: "no-store" as RequestCache,
    headers: buildHeaders(tenant, init?.headers as Record<string, string>),
    dispatcher: dispatcher as unknown as never,
  } as any);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OLVM error (${res.status}): ${detail.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.text();
};

export const initIsoUploadSession = async (
  tenantId: string,
  fileName: string,
  fileSize: number,
  storageDomainId: string,
  sessions: Map<string, UploadSession>,
  sessionId: string,
): Promise<UploadSession> => {
  const tenant = resolveTenant(tenantId);

  // 1. Crear disco ISO
  const diskRes = await doFetch(tenant, "/disks", {
    method: "POST",
    body: JSON.stringify({
      name: fileName,
      alias: fileName,
      content_type: "iso",
      format: "raw",
      sparse: false,
      provisioned_size: fileSize,
      storage_domains: { storage_domain: [{ id: storageDomainId }] },
    }),
  });
  let diskId = "";
  if (typeof diskRes === "string") {
    const m = diskRes.match(/<disk[^>]*id="([^"]+)"/) ?? diskRes.match(/"id"\s*:\s*"([^"]+)"/);
    diskId = m?.[1] ?? "";
  }
  if (!diskId) throw new Error("No se pudo crear el disco ISO");

  // 2. Esperar disco ok
  for (let i = 0; i < 30; i++) {
    const d = await doFetch(tenant, `/disks/${diskId}`);
    let status = "";
    if (typeof d === "string") {
      const m = d.match(/<status[^>]*>([^<]+)<\/status>/) ?? d.match(/"status"\s*:\s*"([^"]+)"/);
      status = m?.[1]?.trim() ?? "";
    }
    if (status === "ok") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 3. Crear image transfer
  const transferRes = await doFetch(tenant, "/imagetransfers", {
    method: "POST",
    body: JSON.stringify({ disk: { id: diskId }, direction: "upload" }),
  });
  let transferId = "";
  let proxyUrl = "";
  if (typeof transferRes === "string") {
    const idMatch = transferRes.match(/id="([^"]+)"/);
    transferId = idMatch?.[1] ?? "";
    const proxyMatch = transferRes.match(/<proxy_url>([^<]+)<\/proxy_url>/);
    const transferUrlMatch = transferRes.match(/<transfer_url>([^<]+)<\/transfer_url>/);
    proxyUrl = proxyMatch?.[1] ?? transferUrlMatch?.[1] ?? "";
  }
  if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar la transferencia");

  // 4. Esperar transfer ready
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const t = await doFetch(tenant, `/imagetransfers/${transferId}`);
    let phase = "";
    if (typeof t === "string") {
      const pm = t.match(/<phase>([^<]+)<\/phase>/) ?? t.match(/"phase"\s*:\s*"([^"]+)"/);
      phase = pm?.[1]?.trim() ?? "";
    }
    if (phase === "transferring") break;
    if (phase.includes("failure") || phase.includes("error")) break;
  }

  // 5. Reemplazar hostname por IP del engine
  const engineHost = new URL(tenant.baseUrl).hostname;
  let uploadUrl = proxyUrl;
  try {
    const proxyHost = new URL(proxyUrl).hostname;
    if (proxyHost !== engineHost && proxyHost !== "localhost") {
      uploadUrl = proxyUrl.replace(proxyHost, engineHost);
    }
  } catch { /* keep original */ }

  const dispatcher = new UndiciAgent({
    connect: { rejectUnauthorized: false },
    bodyTimeout: 0,
    headersTimeout: 0,
    keepAliveTimeout: 30000,
  });

  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  const s: UploadSession = {
    tenant, fileName, fileSize, storageDomainId,
    diskId, transferId, uploadUrl,
    receivedChunks: 0, totalChunks, dispatcher,
  };
  sessions.set(sessionId, s);
  return s;
};

export const uploadIsoChunk = async (
  sessionId: string,
  chunkIndex: number,
  _totalChunks: number,
  chunkBuffer: Buffer,
  sessions: Map<string, UploadSession>,
): Promise<{ done: boolean }> => {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Sesión no encontrada");

  const start = chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + chunkBuffer.length, s.fileSize);

  const res = await fetch(s.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(chunkBuffer.length),
      "Content-Range": `bytes ${start}-${end - 1}/${s.fileSize}`,
    },
    body: chunkBuffer,
    dispatcher: s.dispatcher as unknown as never,
    duplex: "half",
  } as any);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Chunk ${chunkIndex} fallido (${res.status}): ${detail.slice(0, 200)}`);
  }

  s.receivedChunks++;
  return { done: s.receivedChunks >= s.totalChunks };
};

export const finalizeIsoUpload = async (
  sessionId: string,
  sessions: Map<string, UploadSession>,
): Promise<void> => {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Sesión no encontrada");
  await doFetch(s.tenant, `/imagetransfers/${s.transferId}/finalize`, {
    method: "POST",
    body: "{}",
  });
};
