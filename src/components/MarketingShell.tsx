import Link from "next/link";

const FOOTER_SECTIONS = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export default function MarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[var(--brand-primary)] ring-1 ring-black/10">
              <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-zinc-900 font-display">
              TheBinder
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/#product" className="hover:text-zinc-900">
                Product
              </Link>
              <Link href="/pricing" className="hover:text-zinc-900">
                Pricing
              </Link>
              <Link href="/demo" className="hover:text-zinc-900">
                Demo
              </Link>
              <Link href="/help" className="hover:text-zinc-900">
                FAQ
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/login" className="btn-secondary">
                Sign in
              </Link>
              <Link href="/login" className="btn-primary">
                Create free account
              </Link>
            </div>
          </div>
        </header>

        <div className="mt-8">{children}</div>

        <footer className="mt-16 border-t pt-8 text-sm text-zinc-600">
          <div className="grid gap-8 sm:grid-cols-[1.25fr_1fr_1fr_1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[var(--brand-primary)] ring-1 ring-black/10">
                  <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
                </div>
                <div className="font-display text-base font-semibold text-zinc-900">TheBinder</div>
              </div>
              <div className="text-xs text-zinc-500">Made for collectors.</div>
            </div>
            {FOOTER_SECTIONS.map((section) => (
              <div key={section.title} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {section.title}
                </div>
                <div className="flex flex-col gap-2">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-zinc-600 hover:text-zinc-900"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 text-xs text-zinc-500">
            © 2026 TheBinder. All rights reserved.
          </div>
        </footer>
      </div>
    </main>
  );
}
