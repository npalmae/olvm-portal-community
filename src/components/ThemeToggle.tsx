"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("vp-theme", theme);
  } catch {
    // almacenamiento no disponible: solo aplica en memoria
  }
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="inline-flex h-7 w-7 items-center justify-center rounded border transition hover:border-violet-300 dark:border-violet-500/40 dark:hover:border-violet-500/40 hover:bg-violet-50 dark:bg-violet-500/10 dark:hover:bg-violet-500/10 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
    >
      {theme === "dark" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
