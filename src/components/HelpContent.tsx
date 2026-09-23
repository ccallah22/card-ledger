// Authenticated Help architecture: the actual Help/FAQ/support content,
// shared verbatim between the public marketing page (src/app/help/page.tsx,
// wrapped in MarketingShell) and the authenticated page
// (src/app/(app)/account/help/page.tsx, which relies on AppShell's own
// chrome instead). This component deliberately contains ONLY the reusable
// content -- no MarketingShell, no AppShell, no route-specific wrapper of
// any kind -- so it renders identically and correctly regardless of which
// shell (or no shell at all) surrounds it. Extracted from the public page
// with no content changes; SupportFormClient (also shared, moved alongside
// this from src/app/help/) is itself already route-agnostic (posts to
// /api/support, reads window.location.href for context), so it needed no
// changes either.
import SupportFormClient from "@/components/SupportFormClient";

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

export default function HelpContent() {
  return (
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

      <SupportFormClient />

      <div className="space-y-3">
        {FAQS.map((item) => (
          <div key={item.q} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-900">{item.q}</div>
            <div className="mt-2 text-sm text-zinc-700">{item.a}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
