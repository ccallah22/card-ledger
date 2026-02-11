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
        <h1 className="font-display text-zinc-900">
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

      <section className="mt-20 space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            How It Works
          </p>
          <h2 className="font-display text-zinc-900">
            Get organized in minutes.
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">1. Add your cards</div>
            <p className="mt-3 text-sm text-zinc-600">
              Quick manual entry built for speed and clarity.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              2. Attach the details that matter
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Condition, parallel, serial number, purchase price, location.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              3. Track your collection like a pro
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              See totals, trends, and opportunities instantly.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="font-display text-zinc-900">
            Everything you need. Nothing you don’t.
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Clarity
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Stop guessing what you own. Find anything instantly.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Confidence
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Know your numbers before you buy or sell.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Control
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Track where every card lives — binder, box, vault.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Peace of Mind
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Export your collection anytime. Your data stays yours.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="font-display text-zinc-900">
            Your collection data stays yours.
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Private by default
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Secure authentication
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Export anytime
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              No lock-in
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="font-display text-zinc-900">FAQ</h2>
          <p className="text-sm text-zinc-600">Quick answers to common questions.</p>
        </div>
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">Is TheBinder free?</div>
            <p className="mt-2 text-sm text-zinc-600">
              Yes. Start free. Upgrade only if you want advanced tools.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">Do I need to scan cards?</div>
            <p className="mt-2 text-sm text-zinc-600">
              No. Built for clean, accurate manual tracking first.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">
              Can I track location like binder or safe?
            </div>
            <p className="mt-2 text-sm text-zinc-600">Yes. Location tracking is core.</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">
              Can I export my collection?
            </div>
            <p className="mt-2 text-sm text-zinc-600">Yes. Anytime.</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">Who is this for?</div>
            <p className="mt-2 text-sm text-zinc-600">
              Collectors who want clarity and control.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-20">
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-8 text-center shadow-sm sm:p-10">
          <h2 className="font-display text-zinc-900">
            Build the collection tracker you’ll actually use.
          </h2>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a href="/login" className="btn-primary">
              Create Free Account
            </a>
            <a href="/demo" className="btn-secondary">
              See Demo
            </a>
          </div>
          <div className="mt-3 text-xs text-zinc-500">No credit card required.</div>
        </div>
      </section>

      <section id="product" className="mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="font-display text-zinc-900">
            See your collection the way it should look.
          </h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Collection View</div>
              <div className="mt-3 h-3 w-2/3 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-zinc-200" />
              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="h-20 rounded bg-white shadow-sm" />
                <div className="h-20 rounded bg-white shadow-sm" />
                <div className="h-20 rounded bg-white shadow-sm" />
              </div>
            </div>
            <p className="mt-4 text-sm text-zinc-600">
              Your entire collection. Instantly searchable. Filter by player, set, year, condition,
              value, location, or status.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Card Detail</div>
              <div className="mt-3 h-24 rounded bg-white shadow-sm" />
              <div className="mt-3 h-3 w-3/4 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-zinc-200" />
            </div>
            <p className="mt-4 text-sm text-zinc-600">
              Every card has a home. Photos, purchase info, notes, history, and valuation — all in
              one place.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="aspect-[3/2] rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-4">
              <div className="text-xs font-semibold text-zinc-500">Analytics / Valuation</div>
              <div className="mt-4 h-3 w-1/2 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-zinc-200" />
              <div className="mt-6 h-16 rounded bg-white shadow-sm" />
            </div>
            <p className="mt-4 text-sm text-zinc-600">
              Understand your collection at a glance. Total invested. Estimated value. Portfolio
              breakdown.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
