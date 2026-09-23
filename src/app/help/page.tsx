import MarketingShell from "@/components/MarketingShell";
import HelpContent from "@/components/HelpContent";
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

// Public/marketing Help page -- unchanged URL, unchanged shell, unchanged
// audience. The actual content now lives in the shared HelpContent
// component (src/components/HelpContent.tsx) so the authenticated
// /account/help route can reuse it verbatim without duplicating the
// FAQ list or the support form. This page owns only what's genuinely
// specific to the public/marketing context: the MarketingShell wrapper.
export default function HelpPage() {
  return (
    <MarketingShell>
      <HelpContent />
    </MarketingShell>
  );
}
