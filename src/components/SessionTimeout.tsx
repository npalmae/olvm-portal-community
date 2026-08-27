"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "@/components/LocaleProvider";
import { consoleMessages } from "@/i18n/console";

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const WARNING_AT_MS = 25 * 60 * 1000;

export function SessionTimeout() {
  const t = useTranslations(consoleMessages);
  const { data: session, status } = useSession();
  const lastActivityRef = useRef(Date.now());
  const signingOutRef = useRef(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;

    lastActivityRef.current = Date.now();
    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      setShowWarning(false);
    };
    const expire = (reason: "inactivity" | "expired") => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      void signOut({ redirect: false }).finally(() => {
        window.location.href = `/login?reason=${reason}`;
      });
    };
    const events = ["mousedown", "keydown", "mousemove", "click", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, resetActivity, { passive: true }));
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_LIMIT_MS) expire("inactivity");
      else setShowWarning(elapsed >= WARNING_AT_MS);
    }, 10_000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetActivity));
      window.clearInterval(interval);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.expires) return;
    const remaining = new Date(session.expires).getTime() - Date.now();
    if (remaining <= 0) {
      if (!signingOutRef.current) {
        signingOutRef.current = true;
        void signOut({ redirect: false }).finally(() => {
          window.location.href = "/login?reason=expired";
        });
      }
      return;
    }

    const timeout = window.setTimeout(() => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      void signOut({ redirect: false }).finally(() => {
        window.location.href = "/login?reason=expired";
      });
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [session?.expires, status]);

  if (!showWarning || status !== "authenticated") return null;

  return (
    <div className="fixed left-1/2 top-3 z-[100] flex w-[min(92vw,36rem)] -translate-x-1/2 items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-lg">
      <span>{t("sessionWarning")}</span>
      <button
        type="button"
        onClick={() => {
          lastActivityRef.current = Date.now();
          setShowWarning(false);
        }}
        className="ml-3 rounded border border-amber-300 px-2 py-1 font-semibold hover:bg-amber-100"
      >
        {t("keepSession")}
      </button>
    </div>
  );
}
