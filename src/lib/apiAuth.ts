import { NextResponse } from "next/server";
import { validateApiKey } from "./apiKeyStore";

export const checkApiKey = async (request: Request): Promise<boolean> => {
  const provided = request.headers.get("x-api-key") ?? "";
  if (!provided) return false;
  return validateApiKey(provided);
};

export const unauthorizedResponse = () =>
  NextResponse.json(
    { error: "Unauthorized. Provide X-API-Key header." },
    { status: 401 },
  );
