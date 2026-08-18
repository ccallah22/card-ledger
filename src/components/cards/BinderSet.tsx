
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
  // Phase 2B.3: a real <button> instead of a div with role="button" --
  // Enter/Space activation now comes from native button semantics, so the
  // manual onKeyDown handler that used to reimplement it is gone (dead
  // code once the real element does this for free). aria-expanded/
  // aria-controls expose the collapse state and its target region.
  const contentId = `binder-set-${groupKey}`;

  return (
    <div key={groupKey}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        className={
          "flex w-full items-center gap-3 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white bg-[var(--brand-primary)] cursor-pointer " +
          (collapsed && isLast ? "rounded-b-xl" : "")
        }
      >
        <div className="inline-flex items-center gap-2 text-left">
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <span>{label}</span>
          <span className="text-[10px] font-medium text-zinc-400">({countLabel})</span>
        </div>
      </button>

      {!collapsed ? <div id={contentId}>{children}</div> : null}
    </div>
  );
}
