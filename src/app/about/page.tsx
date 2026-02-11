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
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">About</h1>
        <p className="text-base text-zinc-700">
          TheBinder was built by a collector who wanted a calm, reliable way to track cards without
          messy spreadsheets. It’s for hobbyists who care about organization, value, and protecting
          their collection.
        </p>
        <p className="text-base text-zinc-700">
          The goal is simple: make it effortless to know what you own, what you want next, and what
          you’ve sold—on any device.
        </p>
      </section>
    </MarketingShell>
  );
}
