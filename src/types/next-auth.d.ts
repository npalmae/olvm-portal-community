import NextAuth, { DefaultSession } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: DefaultSession["user"] & {
      id: string;
      tenantId: string;
      role: "user" | "admin" | "superadmin";
    };
  }

  interface User {
    id: string;
    tenantId: string;
    role: "user" | "admin" | "superadmin";
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    tenantId: string;
    role: "user" | "admin" | "superadmin";
  }
}
