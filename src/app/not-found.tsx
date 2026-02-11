import Link from "next/link";
import MarketingShell from "@/components/MarketingShell";

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Page not found
        </h1>
        <p className="text-base text-zinc-600">
          The page you’re looking for doesn’t exist. Use the links below to get back on track.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn-secondary">
            Back to home
          </Link>
          <Link href="/cards" className="btn-primary">
            Go to Binder
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
