import { NextResponse } from "next/server";
import { fetchVmById, updateVmResources } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: { tenantId: string; vmId: string };
};

export async function GET(_: Request, { params }: Params) {
  try {
    const vm = await fetchVmById(params.tenantId, params.vmId);
    return NextResponse.json(vm);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const body = await request.json();
    const { memoryMB, cpuCores, sockets } = body;
    if (!memoryMB && !cpuCores) {
      return NextResponse.json(
        { error: "Provide at least one field to update" },
        { status: 400 },
      );
    }

    await updateVmResources(params.tenantId, params.vmId, {
      memoryMB,
      cpuCores,
      sockets,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
