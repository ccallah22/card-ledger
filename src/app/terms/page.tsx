import MarketingShell from "@/components/MarketingShell";

export default function TermsPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Terms of Service
        </h1>
        <p className="text-sm text-zinc-600">Last updated: February 10, 2026</p>
        <div className="space-y-3 text-sm text-zinc-700">
          <p>
            By using TheBinder, you agree to use the service responsibly and to keep your account
            secure. You retain ownership of your collection data.
          </p>
          <p>
            We provide the service as-is and work hard to keep it available, but we can’t guarantee
            uninterrupted access.
          </p>
          <p>
            If you have questions, contact{" "}
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
