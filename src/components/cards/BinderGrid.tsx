// Phase 2B.2: emptyState is now caller-supplied instead of one hardcoded
// message, so the page can distinguish "no cards at all" from "no cards
// match your filters" (two different situations that need different
// wording and a different action) without this component knowing which
// case it is. When omitted, children render normally.
export function BinderGrid({
  emptyState,
  children,
}: {
  emptyState?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black bg-zinc-50 overflow-hidden">
      {emptyState ?? <div className="space-y-3">{children}</div>}
    </div>
  );
}
