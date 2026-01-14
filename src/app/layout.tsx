import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OLVM Admin Portal",
  description: "Portal de administración multitenant para OLVM/oVirt",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
