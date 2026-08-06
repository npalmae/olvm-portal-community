import type { Metadata } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import { SessionProvider } from "next-auth/react";
import { SessionTimeout } from "@/components/SessionTimeout";
import { LocaleProvider, type Locale } from "@/components/LocaleProvider";
import "./globals.css";

const localeMetadata: Record<Locale, Pick<Metadata, "title" | "description">> = {
  es: { title: "Portal de administración OLVM", description: "Portal de administración multitenant para OLVM/oVirt" },
  en: { title: "OLVM Administration Portal", description: "Multitenant administration portal for OLVM/oVirt" },
  de: { title: "OLVM-Verwaltungsportal", description: "Mandantenfähiges Verwaltungsportal für OLVM/oVirt" },
  pt: { title: "Portal de administração OLVM", description: "Portal de administração multitenant para OLVM/oVirt" },
};

const getRequestLocale = async (): Promise<Locale> => {
  const value = (await cookies()).get("olvm_locale")?.value;
  return value === "en" || value === "de" || value === "pt" ? value : "es";
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    ...localeMetadata[locale],
    icons: {
      icon: "/sixmanager-favicon.png",
      shortcut: "/sixmanager-favicon.png",
      apple: "/sixmanager-favicon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body className="antialiased">
        {process.env.NODE_ENV === "development" ? (
          <Script id="disable-next-overlay" strategy="beforeInteractive">
            {`
              window.__NEXT_DISABLE_ERROR_OVERLAY = true;
              window.__NEXT_DISABLE_DEV_OVERLAY = true;
              window.__NEXT_DISABLE_CONSOLE_OVERLAY = true;
            `}
          </Script>
        ) : null}
        <LocaleProvider initialLocale={locale}>
          <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
            <SessionTimeout />
            {children}
          </SessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
