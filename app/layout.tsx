import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import "./fonts.css";
import "./settings.css";
import "./dashboard-theme.css";

export const metadata: Metadata = {
  title: "Traidin Market Data",
  description: "Auditable Binance USDⓈ-M Futures market data terminal.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
