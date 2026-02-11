import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Terms of Service",
  description: "The terms for using TheBinder.",
  openGraph: {
    title: "TheBinder — Terms of Service",
    description: "The terms for using TheBinder.",
  },
  twitter: {
    title: "TheBinder — Terms of Service",
    description: "The terms for using TheBinder.",
  },
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Terms of Service
        </h1>
        <p className="text-sm text-zinc-600">Effective Date: February 11, 2026</p>
        <div className="space-y-5 text-sm text-zinc-700">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">1. Acceptance</div>
            <p>By using TheBinder, you agree to these terms.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">2. Accounts</div>
            <p>Users are responsible for keeping login credentials secure.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">3. Collection Data</div>
            <p>Users own their uploaded data.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">4. Valuations Disclaimer</div>
            <p>Any price estimates are informational only.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">5. Termination</div>
            <p>We reserve the right to suspend abusive accounts.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">6. Changes</div>
            <p>We may update these terms over time.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">Contact</div>
            <p>
              Email{" "}
              <a className="btn-link" href="mailto:support@thebinder.app">
                support@thebinder.app
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
