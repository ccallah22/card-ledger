import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Pricing",
  description: "Simple pricing with a free plan and a Pro tier coming soon.",
  openGraph: {
    title: "TheBinder — Pricing",
    description: "Simple pricing with a free plan and a Pro tier coming soon.",
  },
  twitter: {
    title: "TheBinder — Pricing",
    description: "Simple pricing with a free plan and a Pro tier coming soon.",
  },
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="space-y-6 max-w-4xl">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
            Pricing
          </h1>
          <p className="text-base text-zinc-700">
            Start free. Upgrade when you want advanced analytics and premium insights.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Free</h2>
            <p className="mt-1 text-sm text-zinc-600">Best for getting started.</p>
            <div className="mt-4 text-3xl font-semibold text-zinc-900">$0</div>
            <ul className="mt-4 space-y-2 text-sm text-zinc-700">
              <li>Track your collection</li>
              <li>CSV export/import</li>
              <li>Basic stats</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900">Pro</h2>
              <span className="rounded-full bg-[var(--brand-primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">Advanced insights for serious collectors.</p>
            <div className="mt-4 text-3xl font-semibold text-zinc-900">$9</div>
            <p className="text-xs text-zinc-500">per month, estimated</p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-700">
              <li>Valuations history</li>
              <li>Advanced analytics</li>
              <li>Unlimited image storage</li>
              <li>Insurance reports</li>
              <li>Shareable showcases</li>
            </ul>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
