import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const CODE_TTL_MS = 5 * 60 * 1000;
const envCooldown = Number(process.env.TWO_FACTOR_COOLDOWN_MS);
const COOLDOWN_MS =
  Number.isFinite(envCooldown) && envCooldown >= 0 ? envCooldown : 30 * 1000;
const MAX_ATTEMPTS = 5;
const storePath =
  process.env.TWO_FACTOR_STORE_PATH ||
  path.join(process.cwd(), "data", "two-factor-challenges.json");

type Challenge = {
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};

type ChallengeStore = Record<string, Challenge>;

const normalize = (email: string) => email.trim().toLowerCase();

const readChallenges = async (): Promise<ChallengeStore> => {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ChallengeStore
      : {};
  } catch {
    return {};
  }
};

const writeChallenges = async (challenges: ChallengeStore) => {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(challenges), "utf8");
};

const purgeExpired = (challenges: ChallengeStore) => {
  const now = Date.now();
  for (const [email, challenge] of Object.entries(challenges)) {
    if (challenge.expiresAt < now) delete challenges[email];
  }
};

const generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

export const canRequestChallenge = async (email: string): Promise<boolean> => {
  const challenge = (await readChallenges())[normalize(email)];
  return !challenge || Date.now() - challenge.createdAt >= COOLDOWN_MS;
};

export const msUntilCanResend = async (email: string): Promise<number> => {
  const challenge = (await readChallenges())[normalize(email)];
  if (!challenge) return 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - challenge.createdAt));
};

export const createChallenge = async (email: string): Promise<string> => {
  const challenges = await readChallenges();
  purgeExpired(challenges);
  const code = generateCode();
  challenges[normalize(email)] = {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
    createdAt: Date.now(),
  };
  await writeChallenges(challenges);
  return code;
};

export const getPendingCode = async (email: string): Promise<string | null> => {
  const challenges = await readChallenges();
  purgeExpired(challenges);
  const challenge = challenges[normalize(email)];
  return challenge?.code ?? null;
};

export const verifyChallenge = async (email: string, code: string): Promise<boolean> => {
  const challenges = await readChallenges();
  purgeExpired(challenges);
  const key = normalize(email);
  const challenge = challenges[key];
  if (!challenge || !code.trim()) return false;

  if (challenge.code === code.trim()) {
    delete challenges[key];
    await writeChallenges(challenges);
    return true;
  }

  challenge.attempts += 1;
  if (challenge.attempts >= MAX_ATTEMPTS) delete challenges[key];
  await writeChallenges(challenges);
  return false;
};
