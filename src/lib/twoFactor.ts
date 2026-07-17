import crypto from "crypto";

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const envCooldown = Number(process.env.TWO_FACTOR_COOLDOWN_MS);
const COOLDOWN_MS =
  Number.isFinite(envCooldown) && envCooldown >= 0 ? envCooldown : 30 * 1000; // 30s entre reenvíos
const MAX_ATTEMPTS = 5;

type Challenge = {
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};

// Store en memoria compartido vía globalThis para sobrevivir a la
// re-instantiación de módulos en dev mode de Next.js (mismo patrón que Prisma).
const globalForChallenges = globalThis as unknown as {
  __ovm2faChallenges?: Map<string, Challenge>;
};

const challenges: Map<string, Challenge> =
  globalForChallenges.__ovm2faChallenges ??
  (globalForChallenges.__ovm2faChallenges = new Map());

const normalize = (email: string) => email.trim().toLowerCase();

const generateCode = () => {
  // 6 dígitos, evita ceros a la izquierda excesivos
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
};

// Limpieza periódica de challenges expirados (cada 5 min)
const purgeExpired = () => {
  const now = Date.now();
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt < now) challenges.delete(key);
  }
};

export const canRequestChallenge = (email: string): boolean => {
  const key = normalize(email);
  const existing = challenges.get(key);
  if (!existing) return true;
  return Date.now() - existing.createdAt >= COOLDOWN_MS;
};

export const msUntilCanResend = (email: string): number => {
  const key = normalize(email);
  const existing = challenges.get(key);
  if (!existing) return 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - existing.createdAt));
};

// Crea (o reemplaza) un challenge y devuelve el código generado.
export const createChallenge = (email: string): string => {
  purgeExpired();
  const key = normalize(email);
  const code = generateCode();
  challenges.set(key, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
    createdAt: Date.now(),
  });
  return code;
};

// Solo para tests: devuelve el código pendiente (o null). No usar en producción.
export const getPendingCode = (email: string): string | null => {
  const key = normalize(email);
  const challenge = challenges.get(key);
  if (!challenge || challenge.expiresAt < Date.now()) return null;
  return challenge.code;
};

// Verifica el código. Single-use: se borra al acertar. Cuenta intentos fallidos.
export const verifyChallenge = (email: string, code: string): boolean => {
  purgeExpired();
  const key = normalize(email);
  const challenge = challenges.get(key);
  if (!challenge) return false;
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(key);
    return false;
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challenges.delete(key);
    return false;
  }

  const provided = code.trim();
  if (!provided) return false;

  if (challenge.code === provided) {
    challenges.delete(key);
    return true;
  }

  challenge.attempts += 1;
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challenges.delete(key);
  }
  return false;
};
