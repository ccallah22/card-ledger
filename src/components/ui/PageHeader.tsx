export type PageHeaderVariant = "default" | "large";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  variant?: PageHeaderVariant;
};

export function PageHeader({ title, subtitle, variant = "default" }: PageHeaderProps) {
  const titleClass =
    variant === "large" ? "text-3xl font-bold" : "text-2xl font-semibold tracking-tight";
  const subtitleClass = variant === "large" ? "text-muted-foreground" : "text-sm text-zinc-600";

  return (
    <div>
      <h1 className={titleClass}>{title}</h1>
      {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
    </div>
  );
}
