import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { validateUpload, reencodeImage, MAX_LOGO_BYTES } from "@/lib/imageUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requireSuperadmin = async () => {
  const session = await auth();
  if (!session?.user) return { denied: true as const, status: 401 };
  if (!isPlatformSuperadmin(session.user)) return { denied: true as const, status: 403 };
  return { denied: false as const };
};

const JSON_RESP = (payload: unknown, status: number) =>
  NextResponse.json(payload, { status });

export async function GET() {
  const check = await requireSuperadmin();
  if (check.denied) return JSON_RESP({ error: "Solo superadmin" }, check.status);

  let row = await prisma.portalBranding.findUnique({ where: { id: 1 } });
  if (!row) row = await prisma.portalBranding.create({ data: { id: 1 } });

  return NextResponse.json({
    brandName: row.brandName ?? "",
    hasLogo: Boolean(row.logoData),
    logoMime: row.logoMime ?? "",
    logoWidth: row.logoWidth ?? 0,
    logoHeight: row.logoHeight ?? 0,
    logoSize: row.logoSize ?? 0,
    updatedAt: row.updatedAt,
    maxBytes: MAX_LOGO_BYTES,
  });
}

export async function POST(req: NextRequest) {
  const check = await requireSuperadmin();
  if (check.denied) return JSON_RESP({ error: "Solo superadmin" }, check.status);

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return JSON_RESP({ error: "Se espera multipart/form-data" }, 415);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return JSON_RESP({ error: "Form inválido" }, 400);
  }

  const file = form.get("logo");
  if (!(file instanceof File)) {
    return JSON_RESP({ error: "Campo 'logo' no es archivo" }, 400);
  }

  const brandNameRaw = form.get("brandName");
  const brandName =
    typeof brandNameRaw === "string" ? brandNameRaw.trim().slice(0, 80) : null;

  const raw = Buffer.from(await file.arrayBuffer());

  const validation = validateUpload(file, raw);
  if (!validation.ok) {
    return JSON_RESP({ error: validation.reason }, validation.status);
  }

  let reencoded;
  try {
    reencoded = await reencodeImage(validation.raw);
  } catch {
    return JSON_RESP(
      { error: "No se pudo procesar la imagen (¿archivo corrupto?)" },
      422,
    );
  }

  await prisma.portalBranding.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      brandName,
      logoData: reencoded.data,
      logoMime: reencoded.mime,
      logoWidth: reencoded.width,
      logoHeight: reencoded.height,
      logoSize: reencoded.size,
    },
    update: {
      brandName,
      logoData: reencoded.data,
      logoMime: reencoded.mime,
      logoWidth: reencoded.width,
      logoHeight: reencoded.height,
      logoSize: reencoded.size,
    },
  });

  return NextResponse.json({
    ok: true,
    brandName,
    logo: {
      mime: reencoded.mime,
      width: reencoded.width,
      height: reencoded.height,
      size: reencoded.size,
    },
  });
}

export async function DELETE() {
  const check = await requireSuperadmin();
  if (check.denied) return JSON_RESP({ error: "Solo superadmin" }, check.status);

  await prisma.portalBranding.upsert({
    where: { id: 1 },
    create: { id: 1, brandName: null, logoData: null, logoMime: null },
    update: { brandName: null, logoData: null, logoMime: null, logoWidth: null, logoHeight: null, logoSize: null },
  });

  return NextResponse.json({ ok: true });
}
