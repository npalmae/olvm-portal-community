"use client";

import { useEffect, useState } from "react";

export type PortalBranding = {
  brandName: string;
  hasLogo: boolean;
  logoUrl: string | null;
  logoWidth: number;
  logoHeight: number;
};

const FALLBACK: PortalBranding = {
  brandName: "OLVM Portal",
  hasLogo: false,
  logoUrl: null,
  logoWidth: 0,
  logoHeight: 0,
};

export function usePortalBranding(): { branding: PortalBranding; loading: boolean } {
  const [branding, setBranding] = useState<PortalBranding>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/branding/global", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setBranding({
            brandName: data.brandName || FALLBACK.brandName,
            hasLogo: Boolean(data.hasLogo),
            logoUrl: data.logoUrl,
            logoWidth: data.logoWidth ?? 0,
            logoHeight: data.logoHeight ?? 0,
          });
        }
      } catch {
        // Silencioso: usamos fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { branding, loading };
}
