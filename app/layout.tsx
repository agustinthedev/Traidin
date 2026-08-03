import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import "./fonts.css";
import "./settings.css";
import "./dashboard-theme.css";
import "./treidin-design-system.css";

export const metadata: Metadata = {
  title: "Treidin Market Data",
  description: "Auditable Binance USDⓈ-M Futures market data terminal.",
  icons: {
    icon: "/treidin-mark-v2-256.png",
    shortcut: "/treidin-mark-v2-256.png",
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
