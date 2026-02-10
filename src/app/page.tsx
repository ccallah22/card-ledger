import MarketingShell from "@/components/MarketingShell";

export default function Home() {
  return (
    <MarketingShell>
      <section className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl font-display">
          TheBinder helps collectors track, value, and protect their collection—without messy
          spreadsheets.
        </h1>
        <p className="text-base text-zinc-600 sm:text-lg">
          Know what you own, where it lives, and what it’s worth at a glance.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a href="/login" className="btn-primary">
            Create free account
          </a>
          <a href="/demo" className="btn-secondary">
            View sample collection
          </a>
        </div>
      </section>

      <section className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[
          "Stay organized even as your collection grows.",
          "Make confident decisions with clear, current values.",
          "Protect your collection with a clean, searchable record.",
          "Spend less time tracking and more time collecting.",
          "See your collection the way serious collectors do.",
        ].map((text) => (
          <div key={text} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
            {text}
          </div>
        ))}
      </section>

      <section className="mt-12">
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
