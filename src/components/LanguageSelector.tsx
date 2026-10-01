"use client";

import { useEffect, useRef, useState } from "react";
import { type Locale, useLocale } from "@/components/LocaleProvider";

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
        ? { background: "var(--accent, #2563eb)", borderColor: "var(--accent, #2563eb)", color: "#fff" }
        : { background: "var(--surface-2, #f7f8fa)", borderColor: "var(--border, #e2e6ea)", color: "var(--text-secondary, #6b7280)" }
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 transition hover:border-blue-300 hover:bg-blue-50"
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
        <div className="absolute right-0 top-9 z-50 min-w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl" role="menu">
          {languages.map((language) => (
            <button
              key={language.locale}
              type="button"
              onClick={() => {
                setLocale(language.locale);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-gray-50 ${language.locale === locale ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"}`}
              role="menuitem"
            >
              <LangChip code={language.locale} active={language.locale === locale} />
              <span>{language.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
