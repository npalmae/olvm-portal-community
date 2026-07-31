import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  getUserByEmail,
  verifyUserCredentials,
  type UserRole,
} from "@/lib/userStore";
import { verifyChallenge } from "@/lib/twoFactor";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
const isTwoFactorRequired = () => process.env.REQUIRE_2FA !== "false";

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
        const user = await verifyUserCredentials(email, credentials.password as string);
        if (!user) return null;

        const userTwoFactorEnabled = user.twoFactorEnabled !== false;
        if (isTwoFactorRequired() && userTwoFactorEnabled) {
          const code = credentials.code;
          if (typeof code !== "string" || !(await verifyChallenge(email, code))) {
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
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  secret: authSecret,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.tenantId = (user as any).tenantId;
        token.defaultTenantId = (user as any).defaultTenantId;
        token.role = (user as any).role;
        token.globalRole = (user as any).globalRole;
        token.memberships = (user as any).memberships ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.defaultTenantId = token.defaultTenantId as string;
        session.user.role = token.role as UserRole;
        session.user.globalRole = (token.globalRole as "superadmin" | null) ?? null;
        session.user.memberships = (token.memberships as any[]) ?? [];
      }
      return session;
    },
  },
});
