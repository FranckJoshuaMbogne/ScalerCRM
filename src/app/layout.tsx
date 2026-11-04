import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (variable weight) so builds never depend on Google Fonts.
const schibsted = localFont({
  variable: "--font-schibsted",
  src: [
    {
      path: "../../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
      weight: "400 900",
      style: "normal",
    },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SCALER", template: "%s · SCALER" },
  description:
    "Omnichannel lead management, marketing automation and sales CRM.",
  applicationName: "SCALER",
  appleWebApp: { capable: true, title: "SCALER", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0e1b33",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
