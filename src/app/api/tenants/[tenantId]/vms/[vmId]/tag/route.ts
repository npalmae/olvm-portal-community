import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { assignTagToVm, removeTagFromVm } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

// POST  → asigna el tag del tenant a la VM
// DELETE → remueve el tag del tenant de la VM
export async function POST(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPlatformSuperadmin(session.user)) {
      return NextResponse.json({ error: "Forbidden: solo superadmin" }, { status: 403 });
    }

    await assignTagToVm(tenantId, vmId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPlatformSuperadmin(session.user)) {
      return NextResponse.json({ error: "Forbidden: solo superadmin" }, { status: 403 });
    }

    await removeTagFromVm(tenantId, vmId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
