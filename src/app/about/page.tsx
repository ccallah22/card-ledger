import MarketingShell from "@/components/MarketingShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TheBinder — About",
  description: "Why TheBinder exists and who it’s built for.",
  openGraph: {
    title: "TheBinder — About",
    description: "Why TheBinder exists and who it’s built for.",
  },
  twitter: {
    title: "TheBinder — About",
    description: "Why TheBinder exists and who it’s built for.",
  },
};

export default function AboutPage() {
  return (
    <MarketingShell>
      <section className="space-y-4 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Why TheBinder Exists
        </h1>
        <p className="text-base text-zinc-700">Spreadsheets work… until they don’t.</p>
        <p className="text-base text-zinc-700">
          Collectors deserve a system built for tracking, valuing, protecting, and actually
          understanding their collection.
        </p>
        <p className="text-base text-zinc-700">
          TheBinder was built by a collector who wanted full ownership, clean organization, and
          real portfolio clarity.
        </p>
        <p className="text-base text-zinc-700">
          Not a marketplace. Not a scanner gimmick. A binder — but smarter.
        </p>
      </section>
    </MarketingShell>
  );
}
