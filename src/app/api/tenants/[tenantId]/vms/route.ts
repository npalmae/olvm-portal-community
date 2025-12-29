import { NextResponse } from "next/server";
import { createVm, fetchVms } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: { tenantId: string };
};

export async function GET(_: Request, { params }: Params) {
  try {
    const vms = await fetchVms(params.tenantId);
    return NextResponse.json(vms);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const body = await request.json();
    const { name, clusterId, templateId, memoryMB, cpuCores, sockets, comment } =
      body;

    if (!name || !clusterId) {
      return NextResponse.json(
        { error: "name and clusterId are required" },
        { status: 400 },
      );
    }

    await createVm(params.tenantId, {
      name,
      clusterId,
      templateId,
      memoryMB,
      cpuCores,
      sockets,
      comment,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
