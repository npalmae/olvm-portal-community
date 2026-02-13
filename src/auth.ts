import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getUserByEmail, verifyUserCredentials } from "@/lib/userStore";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

// Configuración completa CON userStore - solo para API routes (Node.js runtime)
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      id: "credentials",
      name: "Credenciales",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await verifyUserCredentials(
          credentials.email as string,
          credentials.password as string,
        );
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          role: user.role,
        };
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
    async signIn({ user }) {
      if (!user?.email) return false;
      const existing = await getUserByEmail(user.email);
      return Boolean(existing);
    },
  },
  secret: authSecret,
});
