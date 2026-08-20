import { NextResponse } from "next/server";
import { validateApiKey, type ApiKeyContext } from "./apiKeyStore";
import { apiRoleGateCore, type ApiRole } from "./apiRoleGate";

export const checkApiKey = async (request: Request): Promise<ApiKeyContext | null> => {
  const provided = request.headers.get("x-api-key") ?? "";
  if (!provided) return null;
  return validateApiKey(provided);
};

export const unauthorizedResponse = () =>
  NextResponse.json(
    { error: "Unauthorized. Provide X-API-Key header." },
    { status: 401 },
  );

/** Wrapper HTTP del gate: null si permite, NextResponse(403) si bloquea. */
export const apiRoleGate = (
  ctx: ApiKeyContext,
  tenantId: string,
  minimumRole: ApiRole,
): NextResponse | null => {
  const result = apiRoleGateCore(ctx, tenantId, minimumRole);
  if (result.allowed) return null;
  return NextResponse.json({ error: result.error }, { status: result.status });
};

export type { ApiRole };
