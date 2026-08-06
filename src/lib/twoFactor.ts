import crypto from "crypto";
import { prisma } from "./prisma";
import { hashShortLivedSecret, safeEqualHash } from "./crypto";

const CODE_TTL_MS = 5 * 60 * 1000;
const envCooldown = Number(process.env.TWO_FACTOR_COOLDOWN_MS);
const COOLDOWN_MS = Number.isFinite(envCooldown) && envCooldown >= 0 ? envCooldown : 30 * 1000;
const MAX_ATTEMPTS = 5;
const testCodes = new Map<string, string>();
const normalize = (email: string) => email.trim().toLowerCase();

export const canRequestChallenge = async (email: string): Promise<boolean> => {
  const challenge = await prisma.twoFactorChallenge.findUnique({ where: { email: normalize(email) } });
  return !challenge || Date.now() - challenge.createdAt.getTime() >= COOLDOWN_MS;
};

export const msUntilCanResend = async (email: string): Promise<number> => {
  const challenge = await prisma.twoFactorChallenge.findUnique({ where: { email: normalize(email) } });
  return challenge ? Math.max(0, COOLDOWN_MS - (Date.now() - challenge.createdAt.getTime())) : 0;
};

export const createChallenge = async (email: string): Promise<string> => {
  const normalized = normalize(email);
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = new Date();
  await prisma.twoFactorChallenge.upsert({
    where: { email: normalized },
    create: { email: normalized, codeHash: hashShortLivedSecret(`${normalized}:${code}`), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now },
    update: { codeHash: hashShortLivedSecret(`${normalized}:${code}`), expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0, createdAt: now },
  });
  if (process.env.E2E_TEST_MODE === "1") testCodes.set(normalized, code);
  return code;
};

export const getPendingCode = async (email: string): Promise<string | null> => {
  if (process.env.E2E_TEST_MODE !== "1") return null;
  const normalized = normalize(email);
  const challenge = await prisma.twoFactorChallenge.findUnique({ where: { email: normalized } });
  if (!challenge || challenge.expiresAt.getTime() < Date.now()) return null;
  return testCodes.get(normalized) ?? null;
};

export const verifyChallenge = async (email: string, code: string): Promise<boolean> => {
  const normalized = normalize(email);
  const challenge = await prisma.twoFactorChallenge.findUnique({ where: { email: normalized } });
  if (!challenge || challenge.expiresAt.getTime() < Date.now() || !code.trim()) {
    if (challenge) await prisma.twoFactorChallenge.deleteMany({ where: { email: normalized } });
    return false;
  }
  const valid = safeEqualHash(challenge.codeHash, hashShortLivedSecret(`${normalized}:${code.trim()}`));
  if (valid) {
    await prisma.twoFactorChallenge.delete({ where: { email: normalized } });
    testCodes.delete(normalized);
    return true;
  }
  if (challenge.attempts + 1 >= MAX_ATTEMPTS) await prisma.twoFactorChallenge.delete({ where: { email: normalized } });
  else await prisma.twoFactorChallenge.update({ where: { email: normalized }, data: { attempts: { increment: 1 } } });
  return false;
};
