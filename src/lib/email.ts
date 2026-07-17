import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";

const resend = apiKey ? new Resend(apiKey) : null;

export const isEmailConfigured = () => Boolean(resend);

export const sendVerificationCode = async (
  email: string,
  code: string,
): Promise<{ delivered: boolean; fallback: boolean; error?: string }> => {
  const subject = "Tu código de verificación - OLVM Portal";
  const text = `Tu código de verificación es: ${code}\n\nExpira en 5 minutos. Si no solicitaste este código, ignora este correo.`;

  // Sin API key: modo dev, loguea el código a consola.
  if (!resend) {
    console.log(`[2FA dev] Código para ${email}: ${code}`);
    return { delivered: true, fallback: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: email,
      subject,
      text,
    });
    if (error) {
      throw new Error(error.message);
    }
    return { delivered: true, fallback: false };
  } catch (error) {
    // El envío real falló (dominio no verificado, recipiente inválido, etc.).
    // Fallback a consola para no bloquear el login durante pruebas.
    console.warn(
      `[2FA fallback] No se pudo enviar email a ${email}: ${(error as Error).message}`,
    );
    console.log(`[2FA fallback] Código para ${email}: ${code}`);
    return {
      delivered: true,
      fallback: true,
      error: (error as Error).message,
    };
  }
};
