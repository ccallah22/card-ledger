import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Changelog",
  description: "Product updates and improvements for TheBinder.",
  openGraph: {
    title: "TheBinder — Changelog",
    description: "Product updates and improvements for TheBinder.",
  },
  twitter: {
    title: "TheBinder — Changelog",
    description: "Product updates and improvements for TheBinder.",
  },
};

const ENTRIES = [
  {
    date: "February 2026",
    title: "v0.9.2",
    items: [
      "Added card image uploads",
      "Improved login stability",
      "Fixed valuation calculations",
    ],
  },
  {
    date: "February 2026",
    title: "v0.9.1",
    items: ["Added delete card feature", "Improved mobile layout"],
  },
];

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <section className="space-y-6 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Changelog
        </h1>
        <div className="space-y-6">
          {ENTRIES.map((entry) => (
            <div key={entry.date} className="rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="text-sm text-zinc-500">{entry.date}</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900">{entry.title}</div>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {entry.items.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
