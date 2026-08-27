import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/lib/userStore";

// Configuración compartida entre auth.ts (Node runtime, API routes) y
// auth-base.ts (Edge runtime, middleware). Solo contiene lo seguro en Edge:
// sin imports de Node ni de userStore (solo el tipo, que se borra al compilar).
// Mantener aquí los callbacks jwt/session evita que las dos configuraciones
// deriven y produzcan tokens distintos según qué runtime valida la sesión.
export const sharedAuthConfig = {
  session: { strategy: "jwt", maxAge: 30 * 60 },
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
        session.user.defaultTenantId = token.defaultTenantId as string;
        session.user.role = token.role as UserRole;
        session.user.globalRole = (token.globalRole as "superadmin" | null) ?? null;
        session.user.memberships = (token.memberships as any[]) ?? [];
      }
      return session;
    },
  },
} satisfies Partial<NextAuthConfig>;
