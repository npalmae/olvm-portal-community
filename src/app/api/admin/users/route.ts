import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listUsers, createUser, type UserRole } from "@/lib/userStore";
import {
  getDefaultTenantId,
  hasTenantAccess,
  isPlatformSuperadmin,
} from "@/lib/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const isSuperadmin = isPlatformSuperadmin(session.user);
  const adminTenantId = getDefaultTenantId(session.user);

  if (!isSuperadmin && !hasTenantAccess(session.user, adminTenantId, "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  try {
    const users = await listUsers();
    const visibleUsers = isSuperadmin
      ? users
      : users.filter((user) =>
          user.memberships.some((membership) => membership.tenantId === adminTenantId),
        );
    return NextResponse.json(visibleUsers);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const isSuperadmin = isPlatformSuperadmin(session.user);
  const adminTenantId = getDefaultTenantId(session.user);

  if (!isSuperadmin && !hasTenantAccess(session.user, adminTenantId, "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  try {
    const body = await request.json();
    const { email, password, name, alias, tenantId, role } = body;
    if (role !== undefined && !["operator", "user", "admin", "superadmin"].includes(role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    
    if (!email || !password || !name || typeof alias !== "string" || !alias.trim() || !(tenantId || adminTenantId)) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios" },
        { status: 400 }
      );
    }

    const requestedTenantId =
      typeof tenantId === "string" ? tenantId.trim() : "";
    const targetTenantId = isSuperadmin ? requestedTenantId : adminTenantId;
    if (!targetTenantId) {
      return NextResponse.json(
        { error: "No hay tenant por defecto para este administrador" },
        { status: 400 },
      );
    }

    // Solo superadmin puede crear admins globales; tenant admins crean usuarios en su tenant
    if (role === "superadmin" && !isSuperadmin) {
      return NextResponse.json(
        { error: "Solo superadmin puede crear usuarios superadmin" },
        { status: 403 }
      );
    }

    if (!isSuperadmin && requestedTenantId && requestedTenantId !== adminTenantId) {
      return NextResponse.json(
        { error: "Tenant mismatch" },
        { status: 403 },
      );
    }
    
    const user = await createUser({
      email,
      password,
      name,
      alias,
      tenantId: targetTenantId,
      role: (isSuperadmin ? role : role === "operator" ? "operator" : "user") as UserRole,
      twoFactorEnabled:
        isSuperadmin && body.twoFactorEnabled === false ? false : true,
    });
    
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
