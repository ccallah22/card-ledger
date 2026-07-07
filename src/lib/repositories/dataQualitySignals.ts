import type { MyCard } from "@/lib/repositories/myCards";

function cardWord(count: number) {
  return count === 1 ? "card" : "cards";
}

// A single data-quality signal: a per-card presence/absence check shared by
// both nextActions.ts (surfaces missing cards as an actionable card) and
// collectionHealth.ts (scores completeness across all qualifying cards).
//
// - appliesTo lets a future signal scope itself to a subset of cards (e.g.
//   "asking price" only applies to FOR_SALE cards, "grade" only to GRADED
//   cards) instead of every qualifying card.
// - isComplete is the actual presence check: true = this card passes.
// - action holds the Next Actions-specific presentation for this signal;
//   Collection Health only ever reads appliesTo/isComplete.
export type DataQualitySignal = {
  id: string;
  label: string;
  appliesTo: (card: MyCard) => boolean;
  isComplete: (card: MyCard) => boolean;
  action: {
    titleForCount: (count: number) => string;
    description: string;
    severity: "info" | "warning" | "success";
    href: string;
  };
};

const SIGNALS: DataQualitySignal[] = [
  {
    id: "missing-photos",
    label: "missing photos",
    appliesTo: () => true,
    isComplete: (card) => !!card.imagePath,
    action: {
      titleForCount: (count) => `${count} ${cardWord(count)} missing photos`,
      description: "Add a photo so these cards are easier to identify, share, and sell.",
      severity: "warning",
      href: "/cards?needs=photos",
    },
  },
  {
    id: "missing-estimated-value",
    label: "missing an estimated value",
    appliesTo: () => true,
    isComplete: (card) =>
      typeof card.estimatedValue === "number" && Number.isFinite(card.estimatedValue),
    action: {
      titleForCount: (count) => `${count} ${cardWord(count)} missing an estimated value`,
      description: "Set an estimated value so these cards count toward your portfolio stats.",
      severity: "info",
      href: "/cards?needs=value",
    },
  },
  {
    id: "missing-storage-location",
    label: "missing a storage location",
    appliesTo: () => true,
    isComplete: (card) => !!card.location?.trim(),
    action: {
      titleForCount: (count) => `${count} ${cardWord(count)} missing a storage location`,
      description:
        "Assign a location so you can find these cards later and filter by Binder / Box / Safe.",
      severity: "info",
      href: "/cards?needs=location",
    },
  },
];

// Add a new data-quality signal later by appending another entry here --
// both nextActions.ts and collectionHealth.ts automatically pick it up.
export function getDataQualitySignals(): DataQualitySignal[] {
  return SIGNALS;
}
