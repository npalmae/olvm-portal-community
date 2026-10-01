"use client";

import { useEffect, useState } from "react";

type VersionInfo = { version: string; channel: string };

/**
 * F1 — Badge de versión discreto (sidebar inferior, junto al pie).
 */
export function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/system/version")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data) setInfo({ version: data.version, channel: data.channel });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!info) return null;

  return (
    <span
      className="text-[9px] font-mono tracking-wider"
      style={{ color: "var(--sidebar-muted)" }}
      title={`canal: ${info.channel}`}
    >
      v{info.version}
      {info.channel !== "stable" ? ` (${info.channel})` : ""}
    </span>
  );
}
