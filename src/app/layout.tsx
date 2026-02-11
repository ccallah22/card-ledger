import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import AppShell from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});


export const metadata: Metadata = {
  metadataBase: new URL("https://thebinder.app"),
  title: "TheBinder",
  description:
    "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "TheBinder",
    description:
      "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
    images: ["/og.svg"],
  },
  twitter: {
    card: "summary",
    title: "TheBinder",
    description:
      "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
    images: ["/og.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#2b323a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body
        className={`min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased ${inter.variable} font-sans`}
      >
        <Script
          defer
          data-domain="thebinder.app"
          src="https://plausible.io/js/script.js"
          strategy="afterInteractive"
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
