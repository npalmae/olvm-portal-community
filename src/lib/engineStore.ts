import fs from "fs";
import path from "path";

export type OlvmEngine = {
  id: string;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
  caCert?: string;
  sharedStorageDomains?: string[];
  createdAt: string;
};

export type EngineInput = Partial<Omit<OlvmEngine, "createdAt">> & {
  name?: string;
  baseUrl?: string;
};

const storePath =
  process.env.ENGINE_STORE_PATH ||
  path.join(process.cwd(), "data", "engines.json");

let cache: OlvmEngine[] | null = null;

const sanitizeBaseUrl = (url: string) => {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const persist = () => {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(cache, null, 2), "utf8");
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

// Seed desde OLVM_TENANTS o variables individuales (OLVM_BASE_URL etc).
// Se ejecuta cuando no existe engines.json.
const seedEnginesFromEnv = (): OlvmEngine[] => {
  const now = new Date().toISOString();
  const engines: OlvmEngine[] = [];
  const seen = new Set<string>();

  const makeEngine = (
    baseUrl: string,
    username?: string,
    password?: string,
    token?: string,
    allowInsecure?: boolean,
    caCert?: string,
  ): OlvmEngine => {
    const normalized = baseUrl.replace(/\/$/, "");
    const key = `${normalized}::${username ?? ""}`;
    if (seen.has(key)) return engines.find((e) => `${e.baseUrl}::${e.username ?? ""}` === key)!;
    seen.add(key);
    const host = normalized.split("//")[1]?.split("/")[0] ?? "engine";
    const engine: OlvmEngine = {
      id: `engine-${normalized.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`,
      name: `Engine ${host}`,
      baseUrl: normalized,
      username, password, token,
      allowInsecure: allowInsecure === true,
      caCert,
      createdAt: now,
    };
    engines.push(engine);
    return engine;
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
      for (const t of parsed as Record<string, unknown>[]) {
        const baseUrl = sanitizeBaseUrl(String(t.baseUrl ?? ""));
        if (!baseUrl) continue;
        makeEngine(
          baseUrl,
          t.username ? String(t.username) : undefined,
          t.password ? String(t.password) : undefined,
          t.token ? String(t.token) : undefined,
          t.allowInsecure === true,
          t.caCert ? String(t.caCert) : readCaFile(t.caFile as string | undefined),
        );
      }
    }
  } else {
    const baseUrl = process.env.OLVM_BASE_URL;
    if (baseUrl && (process.env.OLVM_USERNAME || process.env.OLVM_TOKEN)) {
      makeEngine(
        baseUrl,
        process.env.OLVM_USERNAME,
        process.env.OLVM_PASSWORD,
        process.env.OLVM_TOKEN,
        process.env.OLVM_ALLOW_INSECURE === "true",
        readCaFile(process.env.OLVM_CA_FILE),
      );
    }
  }

  return engines;
};

export const loadEngines = (): OlvmEngine[] => {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    cache = Array.isArray(parsed) ? (parsed as OlvmEngine[]) : [];
  } catch {
    cache = seedEnginesFromEnv();
    if (cache.length) persist();
  }
  return cache;
};

export const listEngines = (): OlvmEngine[] =>
  loadEngines().map((e) => ({ ...e }));

export const getEngineById = (id: string): OlvmEngine | null => {
  const found = loadEngines().find((e) => e.id === id);
  return found ? { ...found } : null;
};

const validate = (input: EngineInput) => {
  if (!input.name?.trim()) throw new Error("El nombre es obligatorio");
  if (!input.baseUrl?.trim()) throw new Error("La URL del engine es obligatoria");
  if (!input.username && !input.token) {
    throw new Error("Debe definir usuario+contraseña o un token");
  }
  if (input.username && !input.password) {
    throw new Error("La contraseña es obligatoria cuando se usa usuario");
  }
};

export const createEngine = (input: EngineInput): OlvmEngine => {
  validate(input);
  const list = loadEngines();
  const id = input.id?.trim() || `engine-${Date.now()}`;
  if (list.some((e) => e.id === id)) {
    throw new Error(`Ya existe un engine con id "${id}"`);
  }
  const engine: OlvmEngine = {
    id,
    name: input.name!.trim(),
    baseUrl: sanitizeBaseUrl(input.baseUrl!),
    username: input.username?.trim() || undefined,
    password: input.password || undefined,
    token: input.token || undefined,
    allowInsecure: input.allowInsecure === true,
    caCert: input.caCert || undefined,
    sharedStorageDomains: Array.isArray(input.sharedStorageDomains)
      ? input.sharedStorageDomains.filter(Boolean)
      : undefined,
    createdAt: new Date().toISOString(),
  };
  list.push(engine);
  cache = list;
  persist();
  return { ...engine };
};

export const updateEngine = (
  id: string,
  input: EngineInput,
): OlvmEngine => {
  const list = loadEngines();
  const index = list.findIndex((e) => e.id === id);
  if (index === -1) throw new Error("Engine no encontrado");
  const current = list[index];

  const merged: EngineInput = {
    name: input.name ?? current.name,
    baseUrl: input.baseUrl ?? current.baseUrl,
    username: input.username ?? current.username,
    password: input.password ?? current.password,
    token: input.token ?? current.token,
    allowInsecure: input.allowInsecure ?? current.allowInsecure,
    caCert: input.caCert ?? current.caCert,
    sharedStorageDomains: input.sharedStorageDomains ?? current.sharedStorageDomains,
  };

  // Solo validar si hay cambios sustanciales
  if (input.name || input.baseUrl) {
    validate(merged);
  }

  const next: OlvmEngine = {
    ...current,
    name: (merged.name ?? current.name).trim(),
    baseUrl: sanitizeBaseUrl(merged.baseUrl ?? current.baseUrl),
    username: merged.username?.trim() || undefined,
    password: merged.password || undefined,
    token: merged.token || undefined,
    allowInsecure: merged.allowInsecure === true,
    caCert: merged.caCert || undefined,
    sharedStorageDomains: Array.isArray(merged.sharedStorageDomains)
      ? merged.sharedStorageDomains.filter(Boolean)
      : undefined,
  };
  list[index] = next;
  cache = list;
  persist();
  return { ...next };
};

export const deleteEngine = (id: string): void => {
  const list = loadEngines().filter((e) => e.id !== id);
  cache = list;
  persist();
};

// Usado por la migracion automatica desde clusters.json viejo.
export const seedEngine = (engine: OlvmEngine): void => {
  const list = loadEngines();
  if (!list.some((e) => e.id === engine.id)) {
    list.push(engine);
    cache = list;
    persist();
  }
};

export const findEngineByConnection = (
  baseUrl: string,
  username?: string,
): OlvmEngine | null => {
  const normalized = baseUrl.replace(/\/$/, "");
  return (
    loadEngines().find(
      (e) =>
        e.baseUrl === normalized &&
        (e.username ?? "") === (username ?? ""),
    ) ?? null
  );
};
