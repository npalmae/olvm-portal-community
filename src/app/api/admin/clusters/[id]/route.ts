import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  deleteCluster,
  getClusterById,
  updateCluster,
  type ClusterConnection,
} from "@/lib/clusterStore";
import { invalidateDispatcherCache, testConnection } from "@/lib/olvmClient";
import { listUsers } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

const toPublic = (c: ClusterConnection) => ({
  id: c.id,
  name: c.name,
  baseUrl: c.baseUrl,
  authMethod: c.token ? "token" : "basic",
  username: c.username,
  hasPassword: Boolean(c.password),
  hasToken: Boolean(c.token),
  allowInsecure: c.allowInsecure === true,
  tag: c.tag,
  hasCa: Boolean(c.caCert),
  createdAt: c.createdAt,
});

const requireSuperadmin = async () => {
  const session = await auth();
  if (!session?.user) return { denied: { status: 401, message: "Unauthorized" } };
  if (!isPlatformSuperadmin(session.user)) {
    return { denied: { status: 403, message: "Forbidden: solo superadmin" } };
  }
  return { denied: null };
};

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }

  const existing = getClusterById(id);
  if (!existing) {
    return NextResponse.json({ error: "Conexión no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Si no se envía password/token nuevos, conservar los existentes.
  const password =
    typeof body.password === "string"
      ? body.password
      : body.password === null
        ? undefined
        : existing.password;
  const token =
    typeof body.token === "string"
      ? body.token
      : body.token === null
        ? undefined
        : existing.token;

  try {
    const updated = updateCluster(id, {
      name: typeof body.name === "string" ? body.name : existing.name,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : existing.baseUrl,
      username: typeof body.username === "string" ? body.username : existing.username,
      password,
      token,
      allowInsecure: body.allowInsecure === true,
      tag: typeof body.tag === "string" ? body.tag : existing.tag,
      caCert:
        typeof body.caCert === "string"
          ? body.caCert
          : body.caCert === null
            ? undefined
            : existing.caCert,
    });
    invalidateDispatcherCache(id);
    return NextResponse.json(toPublic(updated));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }

  if (!getClusterById(id)) {
    return NextResponse.json({ error: "Conexión no encontrada" }, { status: 404 });
  }

  // Bloquear si hay usuarios con membresía en ese tenant.
  const affected = (await listUsers()).filter((u) =>
    u.memberships.some((m) => m.tenantId === id),
  );
  if (affected.length) {
    return NextResponse.json(
      {
        error: `No se puede eliminar: ${affected.length} usuario(s) asignado(s) a este tenant`,
        users: affected.map((u) => u.email),
      },
      { status: 409 },
    );
  }

  deleteCluster(id);
  invalidateDispatcherCache(id);
  return NextResponse.json({ ok: true });
}
