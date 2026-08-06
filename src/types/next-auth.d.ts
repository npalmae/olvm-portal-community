import NextAuth, { DefaultSession } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";
import type { TenantMembership } from "@/lib/userStore";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: DefaultSession["user"] & {
      id: string;
      tenantId: string;
      defaultTenantId: string;
      role: "operator" | "user" | "admin" | "superadmin";
      globalRole: "superadmin" | null;
      memberships: TenantMembership[];
    };
  }

  interface User {
    id: string;
    tenantId: string;
    defaultTenantId: string;
    role: "operator" | "user" | "admin" | "superadmin";
    globalRole: "superadmin" | null;
    memberships: TenantMembership[];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    tenantId: string;
    defaultTenantId: string;
    role: "operator" | "user" | "admin" | "superadmin";
    globalRole: "superadmin" | null;
    memberships: TenantMembership[];
  }
}
