import MarketingShell from "@/components/MarketingShell";

export default function StatusPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Status
        </h1>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            All systems operational
          </div>
          <p className="mt-2 text-sm text-zinc-600">
            If something isn’t working, email{" "}
            <a className="btn-link" href="mailto:support@thebinder.app">
              support@thebinder.app
            </a>
            .
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
