import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { enforceVmTagPolicy, fetchVmConsoleInfo } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  const url = new URL(request.url);
  const protocolParam = url.searchParams.get("protocol");
  const protocol =
    protocolParam === "spice" || protocolParam === "vnc"
      ? (protocolParam as "spice" | "vnc")
      : "vnc";

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "user");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const withTicket = url.searchParams.get("withTicket") === "1";
    const info = await fetchVmConsoleInfo(tenantId, vmId, protocol, {
      issueTicket: withTicket,
    });
    const host = info.host ?? info.websocket?.engineHost;
    const port = info.tlsPort ?? info.port;

    return NextResponse.json(
      { ...info, host, port, consoleId: info.consoleId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status = lower.includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
