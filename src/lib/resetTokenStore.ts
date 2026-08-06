import crypto from "crypto";
import { prisma } from "./prisma";
import { hashToken } from "./crypto";

type ResetToken = { token: string; email: string; expiresAt: number; used: boolean };

export const createResetToken = async (email: string): Promise<string> => {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  await prisma.$transaction([
    prisma.resetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { used: true }] } }),
    prisma.resetToken.create({ data: {
      tokenHash: hashToken(token), email: email.trim().toLowerCase(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    } }),
  ]);
  return token;
};

export const verifyResetToken = async (token: string): Promise<ResetToken | null> => {
  const row = await prisma.resetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.used || row.expiresAt.getTime() < Date.now()) return null;
  return { token: "", email: row.email, expiresAt: row.expiresAt.getTime(), used: row.used };
};

export const consumeResetToken = async (token: string): Promise<boolean> => {
  const result = await prisma.resetToken.updateMany({
    where: { tokenHash: hashToken(token), used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  });
  return result.count === 1;
};
