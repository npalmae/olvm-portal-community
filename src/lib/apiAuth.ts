import { NextResponse } from "next/server";

const VALID_KEY = () => process.env.API_READ_KEY?.trim();

export const checkApiKey = (request: Request): boolean => {
  const key = VALID_KEY();
  if (!key) return false;
  const provided = request.headers.get("x-api-key") ?? "";
  return provided === key;
};

export const unauthorizedResponse = () =>
  NextResponse.json(
    { error: "Unauthorized. Provide X-API-Key header." },
    { status: 401 },
  );
