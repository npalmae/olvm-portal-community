import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export type OvaLibraryEntry = {
  id: string;
  tenantId: string;
  name: string;
  ovf: string;
  size: number;
  uploadDate: string;
};

const LIBRARY_FILE = () =>
  process.env.OVA_LIBRARY_FILE?.trim() ||
  path.join(process.cwd(), "data", "ova-library.json");

export const readLibrary = async (): Promise<OvaLibraryEntry[]> => {
  try {
    const raw = await readFile(LIBRARY_FILE(), "utf8");
    return JSON.parse(raw) as OvaLibraryEntry[];
  } catch {
    return [];
  }
};

export const writeLibrary = async (entries: OvaLibraryEntry[]) => {
  const file = LIBRARY_FILE();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(entries, null, 2), { mode: 0o644 });
};

export const addOvaToLibrary = async (entry: OvaLibraryEntry) => {
  const entries = await readLibrary();
  const filtered = entries.filter((e) => e.id !== entry.id);
  filtered.push(entry);
  await writeLibrary(filtered);
};

export const removeOvaFromLibrary = async (id: string) => {
  const entries = await readLibrary();
  await writeLibrary(entries.filter((e) => e.id !== id));
};

export const getOvaFromLibrary = async (
  id: string,
  tenantId: string,
): Promise<OvaLibraryEntry | null> => {
  const entries = await readLibrary();
  return entries.find((e) => e.id === id && e.tenantId === tenantId) ?? null;
};

export const listOvasByTenant = async (
  tenantId: string,
): Promise<OvaLibraryEntry[]> => {
  const entries = await readLibrary();
  return entries
    .filter((e) => e.tenantId === tenantId)
    .sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));
};
