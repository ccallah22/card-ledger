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
  priority: "low" | "medium" | "high";
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
    priority: "low",
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
    priority: "medium",
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
    priority: "medium",
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
  {
    id: "missing-purchase-price",
    label: "missing a purchase price",
    priority: "low",
    appliesTo: (card) => card.status === "HAVE" || card.status === "FOR_SALE",
    isComplete: (card) =>
      typeof card.purchasePrice === "number" && Number.isFinite(card.purchasePrice),
    action: {
      titleForCount: (count) =>
        `${count} ${cardWord(count)} ${count === 1 ? "needs" : "need"} purchase prices`,
      description: "Add purchase prices so cost basis, gains, and ROI are more accurate.",
      severity: "info",
      href: "/cards",
    },
  },
  {
    id: "missing-asking-price",
    label: "missing an asking price",
    priority: "high",
    appliesTo: (card) => card.status === "FOR_SALE",
    isComplete: (card) =>
      typeof card.askingPrice === "number" && Number.isFinite(card.askingPrice),
    action: {
      titleForCount: (count) =>
        `${count} for-sale ${cardWord(count)} ${count === 1 ? "needs" : "need"} asking prices`,
      description: "Add asking prices so your for-sale listings are ready.",
      severity: "warning",
      href: "/cards/for-sale",
    },
  },
  {
    id: "missing-grading-details",
    label: "missing grading details",
    priority: "medium",
    appliesTo: (card) => card.gradingStatus === "GRADED",
    // certNumber exists on MyCard, so both grade and certNumber are checked.
    isComplete: (card) => !!card.grade && !!card.certNumber,
    action: {
      titleForCount: (count) =>
        `${count} graded ${cardWord(count)} ${count === 1 ? "needs" : "need"} grading details`,
      description: "Add grade details so your graded-card records are complete.",
      severity: "info",
      href: "/cards",
    },
  },
];

// Add a new data-quality signal later by appending another entry here --
// both nextActions.ts and collectionHealth.ts automatically pick it up.
export function getDataQualitySignals(): DataQualitySignal[] {
  return SIGNALS;
}
