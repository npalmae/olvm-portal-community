import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { sharedAuthConfig } from "@/auth-shared";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
if (!authSecret) {
  console.warn(
    "[auth] Falta AUTH_SECRET o NEXTAUTH_SECRET. Genera uno con `openssl rand -base64 32`.",
  );
}

// Configuración base SIN userStore - compatible con Edge Runtime.
// Usada por el middleware. Los callbacks jwt/session viven en auth-shared
// para no divergir de auth.ts (ver [[ADR-006]] si existe, o auth-shared.ts).
export const {
  handlers: baseHandlers,
  auth: baseAuth,
  signIn: baseSignIn,
  signOut: baseSignOut,
} = NextAuth({
  providers: [
    Credentials({
      id: "credentials",
      name: "Credenciales",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async () => {
        // La autorización real se hace en el API route
        return null;
      },
    }),
  ],
  ...sharedAuthConfig,
  secret: authSecret,
});
