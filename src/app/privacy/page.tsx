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
        <p className="text-sm text-zinc-600">Effective Date: February 11, 2026</p>
        <div className="space-y-5 text-sm text-zinc-700">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">1. Information We Collect</div>
            <ul className="space-y-1">
              <li>
                Account info (email, password via Supabase authentication)
              </li>
              <li>
                Collection data (cards, pricing, images, notes, and locations)
              </li>
              <li>
                Usage analytics (only if added later)
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">2. How We Use Information</div>
            <ul className="space-y-1">
              <li>Provide and improve TheBinder</li>
              <li>Secure accounts</li>
              <li>Communicate important updates</li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">3. Data Storage</div>
            <p>
              Data is stored securely using:
            </p>
            <ul className="space-y-1">
              <li>Supabase (database + authentication)</li>
              <li>Vercel (hosting infrastructure)</li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">4. Cookies</div>
            <p>
              We use essential cookies required for authentication and basic site functionality.
              If we add analytics in the future, we will update this policy.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">5. We Do Not Sell Your Data</div>
            <p>Simple. Clear. Strong.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">6. Contact</div>
            <p>
              Email{" "}
              <a className="btn-link" href="mailto:support@thebinder.app">
                support@thebinder.app
              </a>
              .
            </p>
            <p>
              Domain: thebindr.app
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
