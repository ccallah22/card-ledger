import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-brand",
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
        className={`min-h-screen bg-zinc-50 text-zinc-900 antialiased ${inter.variable} ${spaceGrotesk.variable} font-sans`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
