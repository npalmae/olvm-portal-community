import { Resend } from "resend";
import { decryptField } from "./crypto";

type EmailConfigRow = {
  apiKey: string | null;
  fromAddress: string | null;
  enabled: boolean;
};

let cachedConfig: EmailConfigRow | null = null;
let cacheExpiry = 0;

const getConfigFromDb = async (): Promise<EmailConfigRow | null> => {
  try {
    const { prisma } = await import("./prisma");
    const row = await prisma.emailConfig.findUnique({ where: { id: 1 } });
    if (!row) return null;
    return {
      apiKey: decryptField(row.apiKey) ?? null,
      fromAddress: row.fromAddress,
      enabled: row.enabled,
    };
  } catch {
    return null;
  }
};

export const getEmailConfig = async (): Promise<EmailConfigRow> => {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry) return cachedConfig;

  const dbConfig = await getConfigFromDb();
  cachedConfig = dbConfig ?? {
    apiKey: process.env.RESEND_API_KEY ?? null,
    fromAddress: process.env.RESEND_FROM ?? null,
    enabled: true,
  };
  cacheExpiry = now + 30_000;
  return cachedConfig;
};

export const invalidateEmailConfigCache = () => {
  cachedConfig = null;
  cacheExpiry = 0;
};

export const isEmailConfigured = async () => {
  const config = await getEmailConfig();
  return Boolean(config.apiKey && config.enabled);
};

const createClient = (apiKey: string): Resend => new Resend(apiKey);

export const sendVerificationCode = async (
  email: string,
  code: string,
): Promise<{ delivered: boolean; fallback: boolean; error?: string }> => {
  const subject = "Tu código de verificación - OLVM Portal";
  const text = `Tu código de verificación es: ${code}\n\nExpira en 5 minutos. Si no solicitaste este código, ignora este correo.`;

  const config = await getEmailConfig();
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const fromAddress = config.fromAddress ?? process.env.RESEND_FROM ?? "onboarding@resend.dev";

  if (!apiKey || !config.enabled) {
    return { delivered: false, fallback: true, error: "Email no configurado" };
  }

  try {
    const resend = createClient(apiKey);
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: email,
      subject,
      text,
    });
    if (error) throw new Error(error.message);
    return { delivered: true, fallback: false };
  } catch (error) {
    console.warn(`[2FA] No se pudo enviar email a ${email}: ${(error as Error).message}`);
    return { delivered: false, fallback: true, error: (error as Error).message };
  }
};

export const sendTestEmail = async (
  to: string,
): Promise<{ ok: boolean; error?: string }> => {
  const config = await getEmailConfig();
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const fromAddress = config.fromAddress ?? process.env.RESEND_FROM ?? "onboarding@resend.dev";

  if (!apiKey) return { ok: false, error: "No hay API key configurada" };

  try {
    const resend = createClient(apiKey);
    const { error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject: "Prueba de configuración - OLVM Portal",
      text: "Este es un email de prueba desde OLVM Portal. Si lo recibiste, la configuración funciona correctamente.",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

export const sendPasswordResetEmail = async (
  email: string,
  resetUrl: string,
): Promise<{ delivered: boolean; fallback: boolean; error?: string }> => {
  const subject = "Recuperar contraseña - OLVM Portal";
  const text = `Recibimos una solicitud para restablecer tu contraseña.\n\nHaz clic en el siguiente enlace para crear una nueva contraseña:\n${resetUrl}\n\nEste enlace expira en 30 minutos.\n\nSi no solicitaste este cambio, ignora este correo.`;

  const config = await getEmailConfig();
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const fromAddress = config.fromAddress ?? process.env.RESEND_FROM ?? "onboarding@resend.dev";

  if (!apiKey || !config.enabled) {
    return { delivered: false, fallback: true, error: "Email no configurado" };
  }

  try {
    const resend = createClient(apiKey);
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: email,
      subject,
      text,
    });
    if (error) throw new Error(error.message);
    return { delivered: true, fallback: false };
  } catch (error) {
    console.warn(`[reset] No se pudo enviar email a ${email}: ${(error as Error).message}`);
    return { delivered: false, fallback: true, error: (error as Error).message };
  }
};
