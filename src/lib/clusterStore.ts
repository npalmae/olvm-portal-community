import fs from "fs";
import path from "path";
import {
  loadEngines,
  seedEngine,
  findEngineByConnection,
  type OlvmEngine,
} from "./engineStore";

export type ClusterConnection = {
  id: string;
  name: string;
  engineId: string;
  tag?: string;
  storageDomains?: string[];
  createdAt: string;
};

export type ClusterInput = Partial<Omit<ClusterConnection, "createdAt">> & {
  name?: string;
  engineId?: string;
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

// Migracion automatica: si clusters.json tiene entradas con baseUrl (formato viejo),
// extrae los engines y convierte a { id, name, engineId, tag }.
const migrateOldFormat = (
  raw: unknown,
): ClusterConnection[] => {
  if (!Array.isArray(raw)) return [];
  const oldEntries = raw as Record<string, unknown>[];
  const hasLegacy = oldEntries.some((e) => typeof e.baseUrl === "string");
  if (!hasLegacy) return oldEntries as unknown as ClusterConnection[];

  const now = new Date().toISOString();
  const tenants: ClusterConnection[] = [];

  for (const entry of oldEntries) {
    const baseUrl = sanitizeBaseUrl(String(entry.baseUrl ?? ""));
    const username = entry.username ? String(entry.username) : undefined;

    let engine = baseUrl ? findEngineByConnection(baseUrl, username) : null;
    if (!engine && baseUrl) {
      const engineId = `engine-${baseUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
      engine = {
        id: engineId,
        name: `Engine ${baseUrl.split("//")[1]?.split("/")[0] ?? engineId}`,
        baseUrl,
        username,
        password: entry.password ? String(entry.password) : undefined,
        token: entry.token ? String(entry.token) : undefined,
        allowInsecure: entry.allowInsecure === true,
        caCert: entry.caCert ? String(entry.caCert) : undefined,
        createdAt: now,
      };
      seedEngine(engine);
    }

    tenants.push({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? entry.id ?? "Default"),
      engineId: engine?.id ?? "",
      tag: entry.tag ? String(entry.tag) : undefined,
      createdAt: String(entry.createdAt ?? now),
    });
  }

  return tenants;
};

const seedFromEnv = (): ClusterConnection[] => {
  const now = new Date().toISOString();
  const loadEnginesData = loadEngines();

  const ensureEngine = (conn: {
    baseUrl: string; username?: string; password?: string;
    token?: string; allowInsecure?: boolean; caCert?: string;
  }): string => {
    const baseUrl = sanitizeBaseUrl(conn.baseUrl);
    const existing = findEngineByConnection(baseUrl, conn.username);
    if (existing) return existing.id;

    const engineId = `engine-${baseUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
    const engine: OlvmEngine = {
      id: engineId,
      name: `Engine ${baseUrl.split("//")[1]?.split("/")[0] ?? engineId}`,
      baseUrl,
      username: conn.username,
      password: conn.password,
      token: conn.token,
      allowInsecure: conn.allowInsecure,
      caCert: conn.caCert,
      createdAt: now,
    };
    seedEngine(engine);
    return engineId;
  };

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
        .map((t) => {
          const baseUrl = sanitizeBaseUrl(String(t.baseUrl ?? ""));
          if (!t.id || !baseUrl) return null;
          const engineId = ensureEngine({
            baseUrl,
            username: t.username ? String(t.username) : undefined,
            password: t.password ? String(t.password) : undefined,
            token: t.token ? String(t.token) : undefined,
            allowInsecure: t.allowInsecure === true,
            caCert: t.caCert ? String(t.caCert) : readCaFile(t.caFile as string | undefined),
          });
          return {
            id: String(t.id),
            name: String(t.name ?? t.id ?? "Default"),
            engineId,
            tag: t.tag ? String(t.tag) : undefined,
            storageDomains: Array.isArray(t.storageDomains)
              ? t.storageDomains.map(String)
              : undefined,
            createdAt: now,
          } as ClusterConnection;
        })
        .filter((c): c is ClusterConnection => c !== null);
    }
  }

  const baseUrl = process.env.OLVM_BASE_URL;
  const username = process.env.OLVM_USERNAME;
  const password = process.env.OLVM_PASSWORD;
  if (baseUrl && username && password) {
    const engineId = ensureEngine({
      baseUrl,
      username,
      password,
      token: process.env.OLVM_TOKEN,
      allowInsecure: process.env.OLVM_ALLOW_INSECURE === "true",
      caCert: readCaFile(process.env.OLVM_CA_FILE),
    });
    return [
      {
        id: "default",
        name: "Default",
        engineId,
        createdAt: now,
      },
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
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const migrated = migrateOldFormat(raw);
    cache = migrated;
    if (migrated !== raw) persist();
  } catch {
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
  if (!input.engineId?.trim()) throw new Error("Debe seleccionar un engine");
};

export const createCluster = (input: ClusterInput): ClusterConnection => {
  validate(input);
  const list = load();
  const id = input.id?.trim() || `tenant-${Date.now()}`;
  if (list.some((c) => c.id === id)) {
    throw new Error(`Ya existe un tenant con id "${id}"`);
  }
  const conn: ClusterConnection = {
    id,
    name: input.name!.trim(),
    engineId: input.engineId!.trim(),
    tag: input.tag?.trim() || undefined,
    storageDomains: input.storageDomains && input.storageDomains.length > 0 ? input.storageDomains : undefined,
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
  const list = load();
  const index = list.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Tenant no encontrado");
  const current = list[index];
  const next: ClusterConnection = {
    ...current,
    name: input.name !== undefined ? input.name.trim() : current.name,
    engineId: input.engineId !== undefined ? input.engineId.trim() : current.engineId,
    tag: input.tag !== undefined ? input.tag.trim() || undefined : current.tag,
    storageDomains: input.storageDomains !== undefined
      ? input.storageDomains.length > 0 ? input.storageDomains : undefined
      : current.storageDomains,
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
