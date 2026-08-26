import path from "path";

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OvaUploadMetadata = {
  tenantId: string;
  originalName: string;
  ovf: string;
};

export type OvaStagingFormat = "ova" | "qcow2";

export const getOvaStagingDir = () =>
  process.env.OVA_STAGING_DIR?.trim() || path.join(process.cwd(), "data", "ova-staging");

export const getOvaUploadPaths = (uploadId: string, format: OvaStagingFormat = "ova") => {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new Error("Identificador OVA inválido");
  const dir = getOvaStagingDir();
  return {
    filePath: path.join(/* turbopackIgnore: true */ dir, `${uploadId}.${format}`),
    metadataPath: path.join(/* turbopackIgnore: true */ dir, `${uploadId}.json`),
  };
};
