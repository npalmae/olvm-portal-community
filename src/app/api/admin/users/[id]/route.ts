import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { deleteUser, getUserById, updateMembershipRole, updateUser } from "@/lib/userStore";
import {
  getDefaultTenantId,
  hasTenantAccess,
  isPlatformSuperadmin,
} from "@/lib/authz";
import type { TenantMembership } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

const ensureAdmin = (session: Session | null) => {
  if (!session?.user) return { status: 401, message: "Unauthorized" };
  const isSuperadmin = isPlatformSuperadmin(session.user);
  const adminTenantId = getDefaultTenantId(session.user);
  if (!isSuperadmin && !hasTenantAccess(session.user, adminTenantId, "admin")) {
    return { status: 403, message: "Forbidden" };
  }
  return null;
};

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  const session = await auth();
  const denied = ensureAdmin(session);
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }

  const isSuperadmin = isPlatformSuperadmin(session!.user);
  const adminTenantId = getDefaultTenantId(session!.user);

  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Tenant admins solo pueden tocar usuarios de su tenant
  if (!isSuperadmin) {
    const inTenant = target.memberships.some(
      (membership) => membership.tenantId === adminTenantId,
    );
    if (!inTenant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (target.globalRole === "superadmin") {
      return NextResponse.json(
        { error: "Solo un superadmin puede editar a otro superadmin" },
        { status: 403 },
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!isSuperadmin) {
    const forbiddenFields = [
      "name",
      "alias",
      "email",
      "password",
      "globalRole",
      "memberships",
      "defaultTenantId",
      "twoFactorEnabled",
    ];
    if (forbiddenFields.some((field) => field in body)) {
      return NextResponse.json(
        { error: "Un admin de tenant solo puede cambiar el rol de su tenant" },
        { status: 403 },
      );
    }
    if (! ["operator", "user", "admin"].includes(String(body.membershipRole))) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    try {
      const updated = await updateMembershipRole(
        id,
        adminTenantId,
        body.membershipRole as TenantMembership["role"],
      );
      return NextResponse.json(updated);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  const updates: Parameters<typeof updateUser>[1] = {};

  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.alias === "string") updates.alias = body.alias;
  if (typeof body.email === "string") updates.email = body.email;
  if (typeof body.password === "string" && body.password) {
    updates.password = body.password;
  }

  if (isSuperadmin) {
    if (body.globalRole !== undefined) {
      updates.globalRole = body.globalRole === "superadmin" ? "superadmin" : null;
    }
    if (Array.isArray(body.memberships)) {
      const memberships = body.memberships as Array<Record<string, unknown>>;
      if (memberships.some((membership) =>
        typeof membership.tenantId !== "string" ||
        !["operator", "user", "admin"].includes(String(membership.role)))) {
        return NextResponse.json({ error: "Membresía inválida" }, { status: 400 });
      }
      updates.memberships = memberships as TenantMembership[];
    }
    if (typeof body.defaultTenantId === "string") {
      updates.defaultTenantId = body.defaultTenantId;
    }
    if (body.twoFactorEnabled !== undefined) {
      updates.twoFactorEnabled = body.twoFactorEnabled === true;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No hay campos para actualizar" },
      { status: 400 },
    );
  }

  try {
    const updated = await updateUser(id, updates);
    return NextResponse.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("último superadmin") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  const session = await auth();
  const denied = ensureAdmin(session);
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }

  // No eliminarse a sí mismo
  if (session!.user.id === id) {
    return NextResponse.json(
      { error: "No puedes eliminar tu propia cuenta" },
      { status: 400 },
    );
  }

  const isSuperadmin = isPlatformSuperadmin(session!.user);
  const adminTenantId = getDefaultTenantId(session!.user);

  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  if (!isSuperadmin) {
    if (target.globalRole === "superadmin") {
      return NextResponse.json(
        { error: "Solo un superadmin puede eliminar a un superadmin" },
        { status: 403 },
      );
    }
    const inTenant = target.memberships.some(
      (membership) => membership.tenantId === adminTenantId,
    );
    if (!inTenant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const onlyThisTenant = target.memberships.every(
      (membership) => membership.tenantId === adminTenantId,
    );
    if (!onlyThisTenant) {
      return NextResponse.json(
        {
          error:
            "Solo un superadmin puede eliminar usuarios con acceso a múltiples tenants",
        },
        { status: 403 },
      );
    }
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("último superadmin") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
