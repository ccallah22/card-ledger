import type { MyCard } from "@/lib/repositories/myCards";

export function CardRowMenu({
  card,
  top,
  left,
  isOpen,
  onEdit,
  onMarkSold,
  onDelete,
}: {
  card: MyCard;
  top: number;
  left: number;
  isOpen: boolean;
  onEdit: () => void;
  onMarkSold: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-row-menu
      onClick={(e) => e.stopPropagation()}
      className={
        "fixed z-[9999] w-44 overflow-hidden rounded-xl border bg-white shadow-xl " +
        "origin-top-right transition duration-150 " +
        (isOpen ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95")
      }
      style={{ top, left }}
    >
      <button
        type="button"
        onClick={onEdit}
        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
      >
        Edit
      </button>

      {(card.status ?? "HAVE") !== "SOLD" ? (
        <button
          type="button"
          onClick={onMarkSold}
          className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
        >
          Mark as Sold
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDelete}
        className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
      >
        Delete…
      </button>
    </div>
  );
}
