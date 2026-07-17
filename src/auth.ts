import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getUserByEmail, verifyUserCredentials } from "@/lib/userStore";
import { verifyChallenge } from "@/lib/twoFactor";
import { sharedAuthConfig } from "@/auth-shared";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

// 2FA obligatorio a menos que se desactive explícitamente con REQUIRE_2FA=false
const isTwoFactorRequired = () => process.env.REQUIRE_2FA !== "false";

// Configuración completa CON userStore - solo para API routes (Node.js runtime)
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      id: "credentials",
      name: "Credenciales",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        code: { label: "Código 2FA", type: "text" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email as string;
        const user = await verifyUserCredentials(
          email,
          credentials.password as string,
        );
        if (!user) return null;

        // Segundo factor: código por email (global ON y activado por usuario)
        const userTwoFactorEnabled = user.twoFactorEnabled !== false;
        if (isTwoFactorRequired() && userTwoFactorEnabled) {
          const code = credentials.code;
          if (typeof code !== "string" || !verifyChallenge(email, code)) {
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          defaultTenantId: user.defaultTenantId,
          role: user.role,
          globalRole: user.globalRole,
          memberships: user.memberships,
        };
      },
    }),
  ],
  ...sharedAuthConfig,
  callbacks: {
    ...sharedAuthConfig.callbacks,
    // signIn vive solo aquí: usa userStore (Node), no disponible en Edge.
    async signIn({ user }) {
      if (!user?.email) return false;
      const existing = await getUserByEmail(user.email);
      return Boolean(existing);
    },
  },
  secret: authSecret,
});
