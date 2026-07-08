import Link from "next/link";

export type PageHeaderVariant = "default" | "large";

export type PageHeaderAction = {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
};

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  variant?: PageHeaderVariant;
  action?: PageHeaderAction;
};

export function PageHeader({ title, subtitle, variant = "default", action }: PageHeaderProps) {
  const titleClass =
    variant === "large" ? "text-3xl font-bold" : "text-2xl font-semibold tracking-tight";
  const subtitleClass = variant === "large" ? "text-muted-foreground" : "text-sm text-zinc-600";

  const titleBlock = (
    <div>
      <h1 className={titleClass}>{title}</h1>
      {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
    </div>
  );

  // No action: keep the plain wrapper exactly as before (used by Players
  // today) -- don't introduce the flex/action layout unless it's needed.
  if (!action) {
    return titleBlock;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      {titleBlock}
      <div className="flex gap-2">
        <Link
          href={action.href}
          className={action.variant === "secondary" ? "btn-secondary" : "btn-primary"}
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}
