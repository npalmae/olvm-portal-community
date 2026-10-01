"use client";

import { useEffect, useState } from "react";

type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "olvm-theme";

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === "undefined") return;
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = mode === "auto" ? system : mode;
};

/**
 * v1.3.0 — Conmutador de tema: auto (sistema) → claro → oscuro.
 * Persistido en localStorage; el script del layout evita el destello inicial.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initial: ThemeMode = stored === "light" || stored === "dark" ? stored : "auto";
    setMode(initial);
    applyTheme(initial);
    setReady(true);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (window.localStorage.getItem(STORAGE_KEY) !== "auto") return;
      applyTheme("auto");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const cycle = () => {
    const next: ThemeMode = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  const label =
    mode === "auto" ? "Tema: automático" : mode === "light" ? "Tema: claro" : "Tema: oscuro";

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-blue-300 hover:bg-blue-50"
    >
      {ready && mode === "auto" && (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
        </svg>
      )}
      {ready && mode === "light" && (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" strokeLinecap="round" />
        </svg>
      )}
      {ready && mode === "dark" && (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />
        </svg>
      )}
    </button>
  );
}
