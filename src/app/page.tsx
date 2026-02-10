export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <header className="flex flex-col items-start gap-6">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[var(--brand-primary)] ring-1 ring-black/10">
              <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-zinc-900 font-display">
              TheBinder
            </span>
          </div>
            <a
              href="/login"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              Sign in
            </a>
          </div>

          <div className="max-w-2xl space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl font-display">
              TheBinder helps collectors track, value, and protect their collection—without messy
              spreadsheets.
            </h1>
            <p className="text-base text-zinc-600 sm:text-lg">
              Know what you own, where it lives, and what it’s worth at a glance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/login"
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-primary-strong)]"
            >
              Create free account
            </a>
            <a
              href="/demo"
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              View sample collection
            </a>
          </div>
        </header>

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

        <footer className="mt-16 border-t pt-8 text-sm text-zinc-600">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[var(--brand-primary)] ring-1 ring-black/10">
              <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
            </div>
            <div className="font-display text-base font-semibold text-zinc-900">TheBinder</div>
          </div>
        </footer>
      </div>
    </main>
  );
}
