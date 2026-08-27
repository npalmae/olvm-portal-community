import { NextResponse } from "next/server";
import { baseAuth as auth } from "@/auth-base";
import { getAccessibleTenantIds, hasTenantAccess, isPlatformSuperadmin } from "@/lib/authz";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  // Permitir rutas de auth, setup y API v1 (API key propia) sin autenticación de sesión
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/setup") || pathname.startsWith("/api/v1") || pathname.startsWith("/api/internal/backups/") || pathname === "/login" || pathname === "/register" || pathname === "/reset-password" || pathname === "/setup") {
    return NextResponse.next();
  }
  
  // Verificar autenticación para el resto
  if (!req.auth) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/console") {
    const tenantId = req.nextUrl.searchParams.get("tenantId") ?? "";
    if (!tenantId || !hasTenantAccess(user, tenantId, "user")) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Restringe aislamiento de tenant para usuarios no superadmin
  if (!isPlatformSuperadmin(user)) {
    const parts = pathname.split("/").filter(Boolean);
    const isTenantPath = parts[0] === "api" && parts[1] === "tenants" && parts[2];
    const targetTenantFromPath = isTenantPath ? decodeURIComponent(parts[2]) : null;
    const targetTenantFromQuery =
      req.nextUrl.searchParams.get("tenantId") ?? null;
    const targetTenant = targetTenantFromPath || targetTenantFromQuery;
    const accessibleTenants = getAccessibleTenantIds(user);

    if (targetTenant && !accessibleTenants.includes(targetTenant)) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json(
          { error: "Forbidden: tenant mismatch" },
          { status: 403 },
        );
      }
      const home = new URL("/", req.url);
      return NextResponse.redirect(home);
    }
  }
  
  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/console/:path*", "/api/:path*"],
};
