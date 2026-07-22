import sharp from "sharp";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];
const OUTPUT_MIME = "image/png";
const OUTPUT_EXT = "png";
const MAX_WIDTH = 400;

type MagicSignature = { mime: string; ext: string; bytes: number[] };

const MAGIC_SIGNATURES: MagicSignature[] = [
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/webp", ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: "image/gif", ext: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

export type ImageValidation =
  | { ok: true; raw: Buffer; declaredExt: string; detectedMime: string }
  | { ok: false; reason: string; status: number };

const detectMimeByMagic = (buf: Buffer): string | null => {
  for (const sig of MAGIC_SIGNATURES) {
    if (buf.length < sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buf[i] === b);
    if (matches) return sig.mime;
  }
  return null;
};

export const getExtension = (filename: string): string => {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx + 1).toLowerCase();
};

export const validateUpload = (
  file: File,
  raw: Buffer,
): ImageValidation => {
  if (raw.length === 0) {
    return { ok: false, reason: "Archivo vacío", status: 400 };
  }
  if (raw.length > MAX_LOGO_BYTES) {
    return {
      ok: false,
      reason: `Archivo demasiado grande (máx ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)}MB)`,
      status: 413,
    };
  }

  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `Extensión no permitida. Solo: ${ALLOWED_EXTENSIONS.join(", ")}`,
      status: 415,
    };
  }

  if (ext === "svg") {
    return { ok: false, reason: "SVG no permitido (riesgo de XSS)", status: 415 };
  }

  const detectedMime = detectMimeByMagic(raw);
  if (!detectedMime) {
    return {
      ok: false,
      reason: "No se reconoce el formato de imagen (magic bytes inválidos)",
      status: 415,
    };
  }

  return { ok: true, raw, declaredExt: ext, detectedMime };
};

export type Reencoded = {
  data: Uint8Array<ArrayBuffer>;
  mime: string;
  ext: string;
  width: number;
  height: number;
  size: number;
};

export const reencodeImage = async (raw: Buffer): Promise<Reencoded> => {
  const pipeline = sharp(raw, { failOn: "error" })
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 5 });
  const buffer = await pipeline.toBuffer();
  const metadata = await sharp(buffer).metadata();
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  view.set(buffer);
  return {
    data: view,
    mime: OUTPUT_MIME,
    ext: OUTPUT_EXT,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    size: buffer.length,
  };
};
