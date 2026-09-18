export function DeleteCardDialog({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-card-dialog-title"
        className="w-full max-w-md rounded-2xl border bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="delete-card-dialog-title" className="text-lg font-semibold">
          Delete card?
        </div>

        <div className="mt-1 text-sm text-zinc-600">
          This will permanently remove:
          <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
            {label}
          </div>
        </div>

        {/* Phase 2 button-system migration: was a hardcoded bg-red-600
            solid-fill Delete, inconsistent with the restrained
            .btn-destructive direction established on Card Detail
            (ebfaabc) and generalized into globals.css (c7d5966). Styling
            only -- onCancel/onConfirm, confirmation text, and this
            dialog's own open/close behavior are all unchanged. */}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>

          <button type="button" onClick={onConfirm} className="btn-destructive">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
