export default function DemoPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Sample Collection</h1>
          <p className="text-base text-zinc-600">
            A quick look at how a collection feels inside TheBinder.
          </p>
        </header>

        <section className="mt-10 grid gap-6 lg:grid-cols-3">
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
        </section>

        <div className="mt-10">
          <a
            href="/login"
            className="rounded-md bg-[#2b323a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#242a32]"
          >
            Create free account
          </a>
        </div>
      </div>
    </main>
  );
}
