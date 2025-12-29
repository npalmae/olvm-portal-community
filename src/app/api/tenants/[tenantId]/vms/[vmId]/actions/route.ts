import { NextResponse } from "next/server";
import { sendVmAction } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: { tenantId: string; vmId: string };
};

export async function POST(request: Request, { params }: Params) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 },
      );
    }

    await sendVmAction(params.tenantId, params.vmId, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
