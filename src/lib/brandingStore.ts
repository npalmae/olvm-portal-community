import { prisma } from "./prisma";

export type BrandingConfig = {
  brandName: string | null; logoMime: string | null; logoWidth: number | null;
  logoHeight: number | null; logoSize: number | null; updatedAt: string | null;
};

const DEFAULT: BrandingConfig = {
  brandName: null, logoMime: null, logoWidth: null, logoHeight: null, logoSize: null, updatedAt: null,
};

export const readBrandingConfig = async (): Promise<BrandingConfig> => {
  const row = await prisma.portalBranding.findUnique({ where: { id: 1 } });
  return row ? {
    brandName: row.brandName, logoMime: row.logoMime, logoWidth: row.logoWidth,
    logoHeight: row.logoHeight, logoSize: row.logoSize, updatedAt: row.updatedAt.toISOString(),
  } : DEFAULT;
};

export const writeBrandingConfig = async (cfg: Partial<BrandingConfig>): Promise<BrandingConfig> => {
  const data = {
    brandName: cfg.brandName, logoMime: cfg.logoMime, logoWidth: cfg.logoWidth,
    logoHeight: cfg.logoHeight, logoSize: cfg.logoSize,
  };
  await prisma.portalBranding.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return readBrandingConfig();
};

export const clearBrandingConfig = async (): Promise<void> => {
  await prisma.portalBranding.upsert({ where: { id: 1 }, create: { id: 1 }, update: {
    brandName: null, logoData: null, logoMime: null, logoWidth: null, logoHeight: null, logoSize: null,
  } });
};

export const writeLogo = async (data: Uint8Array): Promise<void> => {
  await prisma.portalBranding.upsert({ where: { id: 1 }, create: { id: 1, logoData: Buffer.from(data) }, update: { logoData: Buffer.from(data) } });
};

export const readLogo = async (): Promise<Buffer | null> => {
  const row = await prisma.portalBranding.findUnique({ where: { id: 1 }, select: { logoData: true } });
  return row?.logoData ? Buffer.from(row.logoData) : null;
};

export const deleteLogo = async (): Promise<void> => {
  await prisma.portalBranding.updateMany({ where: { id: 1 }, data: { logoData: null } });
};

export const LOGO_URL = "/api/branding/logo";
