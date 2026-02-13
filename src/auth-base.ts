import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

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
        token.role = (user as any).role;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  secret: authSecret,
});
