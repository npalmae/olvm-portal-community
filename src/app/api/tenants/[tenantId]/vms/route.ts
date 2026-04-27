import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createVm, fetchVms } from "@/lib/olvmClient";
import { assertTenantAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string }>;
};

const asString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const asPositiveNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

export async function GET(_: Request, context: Params) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId);

    const vms = await fetchVms(tenantId);
    return NextResponse.json(vms);
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("required") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const { tenantId } = await context.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "admin");

    const body = await request.json();
    const name = asString(body?.name);
    const clusterId = asString(body?.clusterId);
    const templateId = asString(body?.templateId);
    const memoryMB = asPositiveNumber(body?.memoryMB);
    const cpuCores = asPositiveNumber(body?.cpuCores);
    const sockets = asPositiveNumber(body?.sockets);
    const comment = asString(body?.comment);

    if (!name || !clusterId) {
      return NextResponse.json(
        { error: "name and clusterId are required" },
        { status: 400 },
      );
    }

    await createVm(tenantId, {
      name,
      clusterId,
      templateId: templateId || undefined,
      memoryMB,
      cpuCores,
      sockets,
      comment: comment || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 500;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
