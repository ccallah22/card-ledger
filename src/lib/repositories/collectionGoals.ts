import type { MyCard } from "@/lib/repositories/myCards";

export type CollectionGoalProgress = {
  id: string;
  title: string;
  description: string;
  current: number;
  target: number;
  percent: number;
  achieved: boolean;
};

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

// The smallest milestone at or above `current` -- the tier the user is
// currently working toward (or has just reached). Beyond the largest fixed
// milestone, keep climbing in steps of 500 so the goal never runs out.
function nextMilestone(current: number): number {
  const found = MILESTONES.find((m) => m >= current);
  if (found !== undefined) return found;
  const step = 500;
  return Math.ceil(current / step) * step;
}

// First (and currently only) goal: a total-card-count milestone. Add more
// goal types later by writing another get*Goal(cards) function with this
// same CollectionGoalProgress shape.
export function getDefaultCollectionGoal(cards: MyCard[]): CollectionGoalProgress | null {
  const qualifyingCards = cards.filter((c) => c.status === "HAVE" || c.status === "FOR_SALE");
  const current = qualifyingCards.length;
  const target = nextMilestone(current);
  const achieved = current >= target;
  const percent = Math.min(100, Math.round((current / target) * 100));

  if (current === 0) {
    return {
      id: "total-card-count",
      title: "Add your first 10 cards",
      description: "Start building your collection by adding 10 cards.",
      current,
      target,
      percent,
      achieved,
    };
  }

  if (achieved) {
    return {
      id: "total-card-count",
      title: `Reached ${target} cards!`,
      description: `You've hit your ${target}-card milestone.`,
      current,
      target,
      percent,
      achieved,
    };
  }

  const remaining = target - current;
  return {
    id: "total-card-count",
    title: `Reach ${target} cards`,
    description: `You're ${remaining} ${remaining === 1 ? "card" : "cards"} away from your next milestone.`,
    current,
    target,
    percent,
    achieved,
  };
}
