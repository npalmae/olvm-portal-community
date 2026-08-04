import { NextResponse } from "next/server";
import { validateApiKey, type ApiKeyContext } from "./apiKeyStore";

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
