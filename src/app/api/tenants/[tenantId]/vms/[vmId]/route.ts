import { NextResponse } from "next/server";
import { fetchVmById, updateVmResources } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

const asPositiveNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

export async function GET(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const vm = await fetchVmById(tenantId, vmId);
    return NextResponse.json(vm);
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("required") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const body = await request.json();
    const memoryMB = asPositiveNumber(body?.memoryMB);
    const cpuCores = asPositiveNumber(body?.cpuCores);
    const sockets = asPositiveNumber(body?.sockets);

    if (!memoryMB && !cpuCores) {
      return NextResponse.json(
        { error: "Provide at least one field to update" },
        { status: 400 },
      );
    }

    await updateVmResources(tenantId, vmId, {
      memoryMB,
      cpuCores,
      sockets,
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
