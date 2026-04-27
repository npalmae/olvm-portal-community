import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { UserRole } from "@/lib/userStore";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
if (!authSecret) {
  console.warn(
    "[auth] Falta AUTH_SECRET o NEXTAUTH_SECRET. Genera uno con `openssl rand -base64 32`.",
  );
}

// Configuración base SIN userStore - compatible con Edge Runtime
// Usado por el middleware
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
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.tenantId = (user as any).tenantId;
        token.defaultTenantId = (user as any).defaultTenantId;
        token.role = (user as any).role;
        token.globalRole = (user as any).globalRole;
        token.memberships = (user as any).memberships ?? [];
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as UserRole;
        session.user.defaultTenantId = token.defaultTenantId as string;
        session.user.globalRole = (token.globalRole as "superadmin" | null) ?? null;
        session.user.memberships = (token.memberships as any[]) ?? [];
      }
      return session;
    },
  },
  secret: authSecret,
});
