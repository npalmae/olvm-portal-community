import fs from "fs";
import path from "path";

export type ClusterConnection = {
  id: string;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  tag?: string;
  caCert?: string; // PEM
  createdAt: string;
};

export type ClusterInput = Partial<Omit<ClusterConnection, "createdAt">> & {
  name?: string;
  baseUrl?: string;
};

const storePath =
  process.env.CLUSTER_STORE_PATH ||
  path.join(process.cwd(), "data", "clusters.json");

let cache: ClusterConnection[] | null = null;

const sanitizeBaseUrl = (url: string) => {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const readCaFile = (filePath?: string): string | undefined => {
  if (!filePath) return undefined;
  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return undefined;
  }
};

// Seed inicial desde OLVM_TENANTS (o fallback de variables únicas).
const seedFromEnv = (): ClusterConnection[] => {
  const now = new Date().toISOString();
  const mapEnv = (t: Record<string, unknown>): ClusterConnection => ({
    id: String(t.id ?? ""),
    name: String(t.name ?? t.id ?? "Default"),
    baseUrl: sanitizeBaseUrl(String(t.baseUrl ?? "")),
    username: t.username ? String(t.username) : undefined,
    password: t.password ? String(t.password) : undefined,
    token: t.token ? String(t.token) : undefined,
    allowInsecure: t.allowInsecure === true,
    tag: t.tag ? String(t.tag) : undefined,
    caCert: t.caCert ? String(t.caCert) : readCaFile(t.caFile as string | undefined),
    createdAt: now,
  });

  if (process.env.OLVM_TENANTS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(process.env.OLVM_TENANTS);
    } catch {
      try {
        parsed = Function(`"use strict"; return (${process.env.OLVM_TENANTS});`)();
      } catch {
        parsed = [];
      }
    }
    if (Array.isArray(parsed)) {
      return (parsed as Record<string, unknown>[])
        .map(mapEnv)
        .filter((c) => c.id && c.baseUrl);
    }
  }

  const baseUrl = process.env.OLVM_BASE_URL;
  const username = process.env.OLVM_USERNAME;
  const password = process.env.OLVM_PASSWORD;
  if (baseUrl && username && password) {
    return [
      mapEnv({
        id: "default",
        name: "Default",
        baseUrl,
        username,
        password,
        allowInsecure: process.env.OLVM_ALLOW_INSECURE === "true",
        token: process.env.OLVM_TOKEN,
        caFile: process.env.OLVM_CA_FILE,
      }),
    ];
  }

  return [];
};

const persist = () => {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(cache, null, 2), "utf8");
};

const load = (): ClusterConnection[] => {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    cache = Array.isArray(parsed) ? (parsed as ClusterConnection[]) : [];
  } catch {
    // Archivo inexistente: inicializa desde el env (seed).
    cache = seedFromEnv();
    if (cache.length) persist();
  }
  return cache;
};

export const listClusters = (): ClusterConnection[] =>
  load().map((c) => ({ ...c }));

export const getClusterById = (id: string): ClusterConnection | null => {
  const found = load().find((c) => c.id === id);
  return found ? { ...found } : null;
};

const validate = (input: ClusterInput) => {
  if (!input.name?.trim()) throw new Error("El nombre es obligatorio");
  if (!input.baseUrl?.trim()) throw new Error("La URL del engine es obligatoria");
  if (!input.username && !input.token) {
    throw new Error("Debe definir usuario+contraseña o un token");
  }
  if (input.username && !input.password) {
    throw new Error("La contraseña es obligatoria cuando se usa usuario");
  }
};

export const createCluster = (input: ClusterInput): ClusterConnection => {
  validate(input);
  const list = load();
  const id = input.id?.trim() || `cluster-${Date.now()}`;
  if (list.some((c) => c.id === id)) {
    throw new Error(`Ya existe una conexión con id "${id}"`);
  }
  const conn: ClusterConnection = {
    id,
    name: input.name!.trim(),
    baseUrl: sanitizeBaseUrl(input.baseUrl!),
    username: input.username?.trim() || undefined,
    password: input.password || undefined,
    token: input.token || undefined,
    allowInsecure: input.allowInsecure === true,
    tag: input.tag?.trim() || undefined,
    caCert: input.caCert || undefined,
    createdAt: new Date().toISOString(),
  };
  list.push(conn);
  cache = list;
  persist();
  return { ...conn };
};

export const updateCluster = (
  id: string,
  input: ClusterInput,
): ClusterConnection => {
  validate(input);
  const list = load();
  const index = list.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Conexión no encontrada");
  const current = list[index];
  const next: ClusterConnection = {
    ...current,
    name: input.name!.trim(),
    baseUrl: sanitizeBaseUrl(input.baseUrl!),
    username:
      input.username !== undefined ? input.username.trim() || undefined : current.username,
    password:
      input.password !== undefined ? input.password || undefined : current.password,
    token: input.token !== undefined ? input.token || undefined : current.token,
    allowInsecure: input.allowInsecure === true,
    tag: input.tag !== undefined ? input.tag.trim() || undefined : current.tag,
    caCert: input.caCert !== undefined ? input.caCert || undefined : current.caCert,
  };
  list[index] = next;
  cache = list;
  persist();
  return { ...next };
};

export const deleteCluster = (id: string): void => {
  const list = load().filter((c) => c.id !== id);
  cache = list;
  persist();
};
