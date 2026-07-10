import type { Metadata } from "next";
import Script from "next/script";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "OLVM Admin Portal",
  description: "Portal de administración multitenant para OLVM/oVirt",
  icons: {
    icon: "/sixmanager-favicon.png",
    shortcut: "/sixmanager-favicon.png",
    apple: "/sixmanager-favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
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
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
