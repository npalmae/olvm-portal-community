"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import { adminMessages, systemMessages, updateMessages } from "@/i18n/admin";

type UpdateInfo = {
  current: string;
  channel: string;
  latest: string | null;
  available: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  repo: string;
};

type VersionInfo = {
  version: string;
  channel: string;
  commit: string | null;
  buildDate: string | null;
};

/**
 * F1 — Sistema y versiones: versión del build, canal y changelog integrado.
 * La detección de actualizaciones (F2) y la auto-actualización (F3) se
 * agregan sobre esta página en próximas versiones del roadmap.
 */
export default function SystemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations({ ...adminMessages, ...systemMessages, ...updateMessages });
  const { locale } = useLocale();
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [loading, setLoading] = useState(true);

  const isSuperadmin =
    session?.user?.globalRole === "superadmin" ||
    session?.user?.role === "superadmin";

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || !isSuperadmin) {
      router.replace("/");
      return;
    }
    Promise.all([
      fetch("/api/system/version").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/system/changelog")
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null),
      fetch("/api/system/updates").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([v, c, u]) => {
        setVersion(v);
        setChangelog(c);
        setUpdates(u);
      })
      .finally(() => setLoading(false));
  }, [status, session, isSuperadmin, router]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/system/updates");
      if (res.ok) setUpdates(await res.json());
    } finally {
      setChecking(false);
    }
  };

  const channelTone =
    version?.channel === "stable"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1 font-semibold text-gray-800" style={{ fontSize: "13px" }}>
              <button onClick={() => router.push("/")} className="flex shrink-0 items-center gap-1 hover:text-blue-600" title={t("home")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M2 7l6-5 6 5v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" />
                  <path d="M6 14.5V9h4v5.5" />
                </svg>
                OLVM-PORTAL
              </button>
              <span className="shrink-0 text-gray-400">/</span>
              <span className="truncate text-gray-700">{t("systemNav")}</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{t("systemTitle")}</h1>
            <p className="text-xs text-gray-500">{t("systemSubtitle")}</p>
          </div>
          <ThemeToggle /><LanguageSelector />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">{t("loading")}</p>
        ) : (
          <>
            <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t("currentVersion")}</p>
                  <p className="font-mono text-xl font-bold text-gray-900">
                    v{version?.version ?? "?"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t("channel")}</p>
                  <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${channelTone}`}>
                    {version?.channel ?? "?"}
                  </span>
                </div>
                {version?.commit && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t("commit")}</p>
                    <p className="font-mono text-xs text-gray-700">{version.commit.slice(0, 7)}</p>
                  </div>
                )}
                {version?.buildDate && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t("buildDate")}</p>
                    <p className="text-xs text-gray-700">{version.buildDate}</p>
                  </div>
                )}
              </div>
              <p className="mt-4 border-t pt-3 text-[11px] text-gray-400" style={{ borderColor: "var(--border)" }}>
                {t("updatesComingSoon")}
              </p>
            </div>

            <div className="mt-5 rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">{t("updatesTitle")}</h2>
                <button
                  onClick={checkNow}
                  disabled={checking}
                  className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {checking ? t("loading") : t("checkNow")}
                </button>
              </div>

              {updates?.available ? (
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      v{updates.latest} {t("newVersionAvailable")}
                    </span>
                    <span className="font-mono text-xs text-gray-500">
                      {updates.current} → {updates.latest}
                    </span>
                    {updates.releaseUrl && (
                      <a
                        href={updates.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-medium text-blue-600 hover:underline"
                      >
                        {t("viewRelease")} ↗
                      </a>
                    )}
                  </div>

                  <button
                    onClick={() => setShowHowTo((v) => !v)}
                    className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    {t("howToUpdate")}
                  </button>

                  {showHowTo && (
                    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                      <p className="mb-2 text-[11px] text-gray-500">{t("checklistNote")}</p>
                      <pre className="overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>{`cd ~/olvm-portal-community
docker exec olvm-db pg_dump -U olvm olvm_portal | gzip > ~/backup-preupdate.sql.gz
git fetch --tags
git checkout v${updates.latest}
docker compose up -d --build`}</pre>
                      <p className="mt-2 text-[11px] text-gray-400">{t("afterUpdate")}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500">{t("upToDate")}</p>
              )}
            </div>

            <div className="mt-5 rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
              <h2 className="mb-3 text-sm font-semibold text-gray-800">{t("changelog")}</h2>
              {changelog ? (
                <div className="space-y-3">
                  {changelog
                    .split("\n")
                    .filter((line) => line.startsWith("## "))
                    .map((heading) => {
                      const title = heading.replace(/^##\s+/, "");
                      const body = changelog.slice(changelog.indexOf(heading) + heading.length);
                      const section = body.split("\n## ")[0];
                      return (
                        <div key={title} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                          <p className="mb-1.5 font-mono text-xs font-bold text-gray-800">{title}</p>
                          <ul className="space-y-1">
                            {section
                              .split("\n")
                              .filter((l) => l.startsWith("- "))
                              .map((item, i) => (
                                <li key={i} className="flex gap-2 text-xs text-gray-600">
                                  <span className="text-gray-300">•</span>
                                  {item.replace(/^-\s+/, "")}
                                </li>
                              ))}
                          </ul>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="text-xs text-gray-500">{t("noChangelog")}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
