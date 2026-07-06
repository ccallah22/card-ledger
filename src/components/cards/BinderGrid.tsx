import Link from "next/link";

export function BinderGrid({
  isEmpty,
  children,
}: {
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black bg-zinc-50 overflow-hidden">
      {isEmpty ? (
        <div className="empty-state space-y-3">
          <div>No cards yet — add your first one to get started.</div>
          <Link href="/cards/new" className="btn-primary">
            Add your first card
          </Link>
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  );
}
