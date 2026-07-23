import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(DATA_DIR, "branding.json");
const LOGO_PATH = join(DATA_DIR, "branding-logo.png");

export type BrandingConfig = {
  brandName: string | null;
  logoMime: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  logoSize: number | null;
  updatedAt: string | null;
};

const DEFAULT: BrandingConfig = {
  brandName: null,
  logoMime: null,
  logoWidth: null,
  logoHeight: null,
  logoSize: null,
  updatedAt: null,
};

export const readBrandingConfig = (): BrandingConfig => {
  try {
    if (!existsSync(CONFIG_PATH)) return DEFAULT;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
};

export const writeBrandingConfig = (cfg: Partial<BrandingConfig>) => {
  const current = readBrandingConfig();
  const updated: BrandingConfig = {
    ...current,
    ...cfg,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  return updated;
};

export const clearBrandingConfig = () => {
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT, null, 2));
};

export const writeLogo = (data: Uint8Array) => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LOGO_PATH, data);
};

export const readLogo = (): Buffer | null => {
  try {
    if (!existsSync(LOGO_PATH)) return null;
    return readFileSync(LOGO_PATH);
  } catch {
    return null;
  }
};

export const deleteLogo = () => {
  try {
    if (existsSync(LOGO_PATH)) {
      const { unlinkSync } = require("fs");
      unlinkSync(LOGO_PATH);
    }
  } catch {
    // silent
  }
};

export const LOGO_URL = "/api/branding/logo";
