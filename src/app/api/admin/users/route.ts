import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listUsers, createUser, type UserRole } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  if (session.user.role !== "superadmin" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  try {
    const users = await listUsers();
    return NextResponse.json(users);
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
  
  if (session.user.role !== "superadmin" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  try {
    const body = await request.json();
    const { email, password, name, tenantId, role } = body;
    
    if (!email || !password || !name || !tenantId) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios" },
        { status: 400 }
      );
    }
    
    // Solo superadmin puede crear admins u otros superadmins
    if ((role === "admin" || role === "superadmin") && session.user.role !== "superadmin") {
      return NextResponse.json(
        { error: "Solo superadmin puede crear usuarios admin/superadmin" },
        { status: 403 }
      );
    }
    
    const user = await createUser({
      email,
      password,
      name,
      tenantId,
      role: (role as UserRole) || "user",
    });
    
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
