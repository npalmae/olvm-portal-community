import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { setSystemSecret, getSystemSecret, SYSTEM_SECRET_KEYS } from "@/lib/systemSecretStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requireSuperadmin = async () => {
  const session = await auth();
  if (!session?.user) return false;
  return isPlatformSuperadmin(session.user);
};

export async function GET() {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "Solo superadmin" }, { status: 403 });
  }
  const user = await getSystemSecret(SYSTEM_SECRET_KEYS.hostSshUser);
  const password = await getSystemSecret(SYSTEM_SECRET_KEYS.hostSshPassword);
  return NextResponse.json({
    hostSshUser: user ?? "",
    hasHostSshPassword: Boolean(password),
  });
}

export async function PUT(request: Request) {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "Solo superadmin" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  try {
    if (typeof body.hostSshUser === "string" && body.hostSshUser.trim()) {
      await setSystemSecret(SYSTEM_SECRET_KEYS.hostSshUser, body.hostSshUser.trim());
    }
    if (typeof body.hostSshPassword === "string" && body.hostSshPassword) {
      await setSystemSecret(SYSTEM_SECRET_KEYS.hostSshPassword, body.hostSshPassword);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
