import { prisma } from "./prisma";
import { decryptField, encryptField } from "./crypto";

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
  brandName?: string;
  brandLogoUrl?: string;
  createdAt: string;
};

export type EngineInput = Partial<Omit<OlvmEngine, "createdAt">> & {
  name?: string;
  baseUrl?: string;
};

type EngineRow = Awaited<ReturnType<typeof prisma.engine.findFirst>>;

const sanitizeBaseUrl = (url: string) => {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const toEngine = (row: NonNullable<EngineRow>): OlvmEngine => ({
  id: row.id,
  name: row.name,
  baseUrl: row.baseUrl,
  username: row.username ?? undefined,
  password: decryptField(row.password),
  token: decryptField(row.token),
  allowInsecure: row.allowInsecure,
  caCert: decryptField(row.caCert),
  sharedStorageDomains: row.sharedStorageDomains.length ? row.sharedStorageDomains : undefined,
  brandName: row.brandName ?? undefined,
  brandLogoUrl: row.brandLogoUrl ?? undefined,
  createdAt: row.createdAt.toISOString(),
});

const validate = (input: EngineInput) => {
  if (!input.name?.trim()) throw new Error("El nombre es obligatorio");
  if (!input.baseUrl?.trim()) throw new Error("La URL del engine es obligatoria");
  if (!input.username && !input.token) throw new Error("Debe definir usuario+contraseña o un token");
  if (input.username && !input.password) throw new Error("La contraseña es obligatoria cuando se usa usuario");
};

export const loadEngines = async (): Promise<OlvmEngine[]> => listEngines();

export const listEngines = async (): Promise<OlvmEngine[]> =>
  (await prisma.engine.findMany({ orderBy: { createdAt: "asc" } })).map(toEngine);

export const getEngineById = async (id: string): Promise<OlvmEngine | null> => {
  const row = await prisma.engine.findUnique({ where: { id } });
  return row ? toEngine(row) : null;
};

export const createEngine = async (input: EngineInput): Promise<OlvmEngine> => {
  validate(input);
  const id = input.id?.trim() || `engine-${Date.now()}`;
  if (await prisma.engine.findUnique({ where: { id } })) throw new Error(`Ya existe un engine con id "${id}"`);
  const row = await prisma.engine.create({
    data: {
      id,
      name: input.name!.trim(),
      baseUrl: sanitizeBaseUrl(input.baseUrl!),
      username: input.username?.trim() || null,
      password: encryptField(input.password),
      token: encryptField(input.token),
      allowInsecure: input.allowInsecure === true,
      caCert: encryptField(input.caCert),
      sharedStorageDomains: input.sharedStorageDomains?.filter(Boolean) ?? [],
      brandName: input.brandName?.trim() || null,
      brandLogoUrl: input.brandLogoUrl?.trim() || null,
    },
  });
  return toEngine(row);
};

export const updateEngine = async (id: string, input: EngineInput): Promise<OlvmEngine> => {
  const current = await getEngineById(id);
  if (!current) throw new Error("Engine no encontrado");
  const merged = { ...current, ...input };
  if (input.name !== undefined || input.baseUrl !== undefined) validate(merged);
  const row = await prisma.engine.update({
    where: { id },
    data: {
      name: merged.name.trim(),
      baseUrl: sanitizeBaseUrl(merged.baseUrl),
      username: merged.username?.trim() || null,
      password: encryptField(merged.password),
      token: encryptField(merged.token),
      allowInsecure: merged.allowInsecure === true,
      caCert: encryptField(merged.caCert),
      sharedStorageDomains: merged.sharedStorageDomains?.filter(Boolean) ?? [],
      brandName: merged.brandName?.trim() || null,
      brandLogoUrl: merged.brandLogoUrl?.trim() || null,
    },
  });
  return toEngine(row);
};

export const deleteEngine = async (id: string): Promise<void> => {
  await prisma.engine.delete({ where: { id } });
};

export const seedEngine = async (engine: OlvmEngine): Promise<void> => {
  await prisma.engine.upsert({
    where: { id: engine.id },
    create: {
      id: engine.id, name: engine.name, baseUrl: sanitizeBaseUrl(engine.baseUrl),
      username: engine.username, password: encryptField(engine.password), token: encryptField(engine.token),
      allowInsecure: engine.allowInsecure ?? false, caCert: encryptField(engine.caCert),
      sharedStorageDomains: engine.sharedStorageDomains ?? [], brandName: engine.brandName,
      brandLogoUrl: engine.brandLogoUrl, createdAt: new Date(engine.createdAt),
    },
    update: {},
  });
};

export const findEngineByConnection = async (baseUrl: string, username?: string): Promise<OlvmEngine | null> => {
  const row = await prisma.engine.findFirst({
    where: { baseUrl: sanitizeBaseUrl(baseUrl), username: username ?? null },
  });
  return row ? toEngine(row) : null;
};
