import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Privacy Policy",
  description: "How TheBinder handles your data and protects your privacy.",
  openGraph: {
    title: "TheBinder — Privacy Policy",
    description: "How TheBinder handles your data and protects your privacy.",
  },
  twitter: {
    title: "TheBinder — Privacy Policy",
    description: "How TheBinder handles your data and protects your privacy.",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Privacy Policy
        </h1>
        <p className="text-sm text-zinc-600">Last updated: February 10, 2026</p>
        <p className="text-base text-zinc-700">
          TheBinder is built for collectors who care about privacy. We only collect the minimum
          data required to operate the app and improve your experience.
        </p>
        <div className="space-y-3 text-sm text-zinc-700">
          <p>
            <span className="font-semibold text-zinc-900">Data you provide:</span> account details,
            your collection data, and optional images you upload.
          </p>
          <p>
            <span className="font-semibold text-zinc-900">How we use it:</span> to store your
            collection, power search, and provide backups.
          </p>
          <p>
            <span className="font-semibold text-zinc-900">We don’t sell your data.</span> Period.
          </p>
          <p>
            <span className="font-semibold text-zinc-900">Questions?</span> Email{" "}
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
