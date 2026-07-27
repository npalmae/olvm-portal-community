import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const STORE_PATH = path.join(process.cwd(), "data", "reset-tokens.json");

type ResetToken = {
  token: string;
  email: string;
  expiresAt: number;
  used: boolean;
};

const readTokens = async (): Promise<ResetToken[]> => {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeTokens = async (tokens: ResetToken[]) => {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(tokens, null, 2));
};

export const createResetToken = async (email: string): Promise<string> => {
  const tokens = await readTokens();
  const now = Date.now();
  const active = tokens.filter((t) => t.expiresAt > now && !t.used);
  const token = crypto.randomBytes(32).toString("hex");
  active.push({ token, email, expiresAt: now + 30 * 60 * 1000, used: false });
  await writeTokens(active);
  return token;
};

export const verifyResetToken = async (token: string): Promise<ResetToken | null> => {
  const tokens = await readTokens();
  const found = tokens.find((t) => t.token === token && !t.used);
  if (!found) return null;
  if (found.expiresAt < Date.now()) return null;
  return found;
};

export const consumeResetToken = async (token: string): Promise<boolean> => {
  const tokens = await readTokens();
  const found = tokens.find((t) => t.token === token);
  if (!found || found.used || found.expiresAt < Date.now()) return false;
  found.used = true;
  await writeTokens(tokens);
  return true;
};
