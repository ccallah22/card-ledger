import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Track and protect your collection",
  description:
    "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
  openGraph: {
    title: "TheBinder — Track and protect your collection",
    description:
      "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
  },
  twitter: {
    title: "TheBinder — Track and protect your collection",
    description:
      "TheBinder helps collectors track, value, and protect their collection—without messy spreadsheets.",
  },
};

export default function Home() {
  return (
    <MarketingShell>
      <section className="max-w-3xl space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl font-display">
          Track, value, and protect your collection — without spreadsheets.
        </h1>
        <p className="text-base text-zinc-600 sm:text-lg">
          TheBinder helps collectors organize, understand, and protect their collection — without
          messy spreadsheets.
        </p>
        <ul className="space-y-2 text-sm text-zinc-700">
          <li>Know exactly what you own — instantly searchable and organized</li>
          <li>Make smarter buying and selling decisions with clear value tracking</li>
          <li>Stay organized across binders, boxes, safes, and cases</li>
          <li>Protect your collection with detailed records and photos</li>
          <li>Feel in control of your collection at all times</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <a href="/login" className="btn-primary">
            Create Free Account
          </a>
          <a href="/demo" className="btn-secondary">
            See Demo
          </a>
        </div>
        <div className="text-xs text-zinc-500">No credit card required. Set up in under 2 minutes.</div>
      </section>

      <section id="product" className="mt-12">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Collection</div>
              <div className="mt-3 h-3 w-2/3 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-zinc-200" />
              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="h-20 rounded bg-white shadow-sm" />
                <div className="h-20 rounded bg-white shadow-sm" />
                <div className="h-20 rounded bg-white shadow-sm" />
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Card detail</div>
              <div className="mt-3 h-24 rounded bg-white shadow-sm" />
              <div className="mt-3 h-3 w-3/4 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-zinc-200" />
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Analytics & Valuations</div>
              <div className="mt-4 h-3 w-1/2 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-zinc-200" />
              <div className="mt-6 h-16 rounded bg-white shadow-sm" />
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
