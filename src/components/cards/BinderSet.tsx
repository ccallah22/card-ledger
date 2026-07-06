
export function BinderSet({
  groupKey,
  label,
  countLabel,
  collapsed,
  isLast,
  children,
  onToggle,
}: {
  groupKey: string;
  label: string;
  countLabel: string;
  collapsed: boolean;
  isLast: boolean;
  children: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <div key={groupKey}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={
          "flex w-full items-center gap-3 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white bg-[var(--brand-primary)] cursor-pointer " +
          (collapsed && isLast ? "rounded-b-xl" : "")
        }
      >
        <div className="inline-flex items-center gap-2 text-left">
          <span>{collapsed ? "▸" : "▾"}</span>
          <span>{label}</span>
          <span className="text-[10px] font-medium text-zinc-400">({countLabel})</span>
        </div>
      </div>

      {!collapsed ? children : null}
    </div>
  );
}
