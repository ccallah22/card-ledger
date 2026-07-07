import type { MyCard } from "@/lib/repositories/myCards";
import { getDataQualitySignals, type DataQualitySignal } from "@/lib/repositories/dataQualitySignals";

export type NextAction = {
  id: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "success";
  href?: string;
};

// Turns one shared data-quality signal into a NextAction summarizing the
// qualifying cards that fail it, or null if there's nothing to flag.
function actionFromSignal(signal: DataQualitySignal, cards: MyCard[]): NextAction | null {
  const applicable = cards.filter((c) => signal.appliesTo(c));
  const missing = applicable.filter((c) => !signal.isComplete(c));
  if (missing.length === 0) return null;

  return {
    id: signal.id,
    title: signal.action.titleForCount(missing.length),
    description: signal.action.description,
    severity: signal.action.severity,
    href: signal.action.href,
  };
}

export function getNextActions(cards: MyCard[]): NextAction[] {
  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  return getDataQualitySignals()
    .map((signal) => actionFromSignal(signal, qualifyingCards))
    .filter((action): action is NextAction => action !== null);
}
