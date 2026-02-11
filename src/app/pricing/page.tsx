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
            TheBinder Pricing
          </h1>
          <p className="text-base text-zinc-700">
            Start free. Upgrade only if you want advanced tools.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Free</h2>
            <p className="mt-1 text-sm text-zinc-600">Everything you need to start.</p>
            <div className="mt-4 text-3xl font-semibold text-zinc-900">$0</div>
            <p className="text-xs text-zinc-500">forever</p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-700">
              <li>Unlimited cards</li>
              <li>Image uploads</li>
              <li>Basic analytics</li>
              <li>CSV export</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900">Pro</h2>
              <span className="rounded-full bg-[var(--brand-accent)]/10 px-3 py-1 text-xs font-semibold text-[var(--brand-accent)]">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">Advanced tools for serious collectors.</p>
            <div className="mt-4 text-3xl font-semibold text-zinc-900">$9</div>
            <p className="text-xs text-zinc-500">per month (coming soon)</p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-700">
              <li>Advanced valuation tracking</li>
              <li>Profit/loss analytics</li>
              <li>Advanced filtering</li>
              <li>Priority support</li>
              <li>Early feature access</li>
            </ul>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
