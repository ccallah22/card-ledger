import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — Help",
  description: "Answers to common questions about TheBinder.",
  openGraph: {
    title: "TheBinder — Help",
    description: "Answers to common questions about TheBinder.",
  },
  twitter: {
    title: "TheBinder — Help",
    description: "Answers to common questions about TheBinder.",
  },
};

const FAQS = [
  {
    q: "How do valuations work?",
    a: "TheBinder stores your value inputs and tracks changes over time. Pro will add valuation history and trend insights.",
  },
  {
    q: "How do I import a CSV?",
    a: "Go to Binder and use Export/Import (CSV) in the More menu. Make sure your file matches the exported format.",
  },
  {
    q: "Is my image private?",
    a: "Yes. Your uploaded images are private by default. If you choose to share a community image, we only store the image for that card’s reference.",
  },
  {
    q: "How do I export my data?",
    a: "Use Export CSV in the More menu, or export a full backup (cards + images) from the Backup page.",
  },
  {
    q: "How will I cancel Pro?",
    a: "When Pro launches, you’ll be able to cancel anytime from your Account page.",
  },
  {
    q: "Where can I get support?",
    a: "Email support@thebinder.app and include a screenshot if possible.",
  },
];

export default function HelpPage() {
  return (
    <MarketingShell>
      <section className="space-y-6 max-w-3xl">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">Help</h1>
          <p className="text-sm text-zinc-600">
            Need help? Start with the FAQs below or email{" "}
            <a className="btn-link" href="mailto:support@thebinder.app">
              support@thebinder.app
            </a>
            .
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((item) => (
            <div key={item.q} className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-semibold text-zinc-900">{item.q}</div>
              <div className="mt-2 text-sm text-zinc-700">{item.a}</div>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
