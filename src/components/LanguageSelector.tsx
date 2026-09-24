"use client";

import { useEffect, useRef, useState } from "react";
import { type Locale, useLocale } from "@/components/LocaleProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

const languages: Array<{ locale: Locale; label: string }> = [
  { locale: "es", label: "Español" },
  { locale: "en", label: "English" },
  { locale: "de", label: "Deutsch" },
  { locale: "pt", label: "Português" },
];

const LangChip = ({ code, active = false }: { code: string; active?: boolean }) => (
  <span
    aria-hidden="true"
    className="inline-flex h-[18px] w-[26px] shrink-0 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none tracking-wide"
    style={
      active
        ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
        : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-secondary)" }
    }
  >
    {code.toUpperCase()}
  </span>
);

export function LanguageSelector() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = languages.find((language) => language.locale === locale) ?? languages[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <ThemeToggle />
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition hover:border-violet-300 dark:border-violet-500/40 dark:hover:border-violet-500/40 hover:bg-violet-50 dark:bg-violet-500/10 dark:hover:bg-violet-500/10"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={active.label}
      >
        <LangChip code={active.locale} active />
        <span className="hidden xl:inline">{active.locale.toUpperCase()}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="m2 3.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-50 min-w-36 overflow-hidden rounded-lg border py-1 shadow-xl"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          role="menu"
        >
          {languages.map((language) => {
            const isActive = language.locale === locale;
            return (
              <button
                key={language.locale}
                type="button"
                onClick={() => {
                  setLocale(language.locale);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  isActive ? "font-semibold" : "hover:bg-violet-50 dark:bg-violet-500/10 dark:hover:bg-violet-500/10"
                }`}
                style={
                  isActive
                    ? { background: "var(--accent-light)", color: "var(--accent-hover)" }
                    : { color: "var(--text-primary)" }
                }
                role="menuitem"
              >
                <LangChip code={language.locale} active={isActive} />
                <span>{language.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
