import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Contact",
  description: "Get help and contact the TheBinder team.",
  openGraph: {
    title: "TheBinder — Contact",
    description: "Get help and contact the TheBinder team.",
  },
  twitter: {
    title: "TheBinder — Contact",
    description: "Get help and contact the TheBinder team.",
  },
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Contact
        </h1>
        <p className="text-sm text-zinc-600">We typically respond within 1 business day.</p>
        <div className="space-y-3 text-base text-zinc-700">
          <p>
            The fastest way to reach us is email. Send questions, feature requests, or issues to{" "}
            <a className="btn-link" href="mailto:support@thebinder.app">
              support@thebinder.app
            </a>
            .
          </p>
          <p>
            If you include a screenshot and the page URL, we can usually fix things much faster.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
