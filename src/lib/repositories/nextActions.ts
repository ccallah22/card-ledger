import type { MyCard } from "@/lib/repositories/myCards";

export type NextAction = {
  id: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "success";
  href?: string;
};

function cardWord(count: number) {
  return count === 1 ? "card" : "cards";
}

// Each rule inspects the already-filtered qualifying cards (HAVE/FOR_SALE
// only) and returns one NextAction summarizing the cards that need
// attention, or null if there's nothing to flag. Add a new rule by writing
// another function with this same shape and listing it in RULES below.

function ruleMissingPhotos(cards: MyCard[]): NextAction | null {
  const missing = cards.filter((c) => !c.imagePath);
  if (missing.length === 0) return null;

  return {
    id: "missing-photos",
    title: `${missing.length} ${cardWord(missing.length)} missing photos`,
    description: "Add a photo so these cards are easier to identify, share, and sell.",
    severity: "warning",
    href: "/cards?needs=photos",
  };
}

function ruleMissingEstimatedValue(cards: MyCard[]): NextAction | null {
  const missing = cards.filter(
    (c) => typeof c.estimatedValue !== "number" || !Number.isFinite(c.estimatedValue)
  );
  if (missing.length === 0) return null;

  return {
    id: "missing-estimated-value",
    title: `${missing.length} ${cardWord(missing.length)} missing an estimated value`,
    description: "Set an estimated value so these cards count toward your portfolio stats.",
    severity: "info",
    href: "/cards?needs=value",
  };
}

function ruleMissingStorageLocation(cards: MyCard[]): NextAction | null {
  const missing = cards.filter((c) => !c.location?.trim());
  if (missing.length === 0) return null;

  return {
    id: "missing-storage-location",
    title: `${missing.length} ${cardWord(missing.length)} missing a storage location`,
    description: "Assign a location so you can find these cards later and filter by Binder / Box / Safe.",
    severity: "info",
    href: "/cards?needs=location",
  };
}

const RULES: ((cards: MyCard[]) => NextAction | null)[] = [
  ruleMissingPhotos,
  ruleMissingEstimatedValue,
  ruleMissingStorageLocation,
];

export function getNextActions(cards: MyCard[]): NextAction[] {
  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  return RULES.map((rule) => rule(qualifyingCards)).filter((action): action is NextAction => action !== null);
}
