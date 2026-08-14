import type { PlayerJourneyMilestone } from "@/lib/repositories/playerOverview";

/**
 * Generic milestone chip row for Player Hub's Collection Journey section.
 * Deliberately knows nothing about specific milestones (no "if key ===
 * first_rookie" branching) -- it only maps over whatever
 * PlayerOverview.journey.milestones provides, so a future repository
 * addition (a new milestone object) renders automatically without any page
 * or component change. Achieved/not-achieved is communicated by both the
 * ✓/○ glyph and a screen-reader-only suffix, not by color alone.
 */
export function PlayerJourneyMilestones({
  milestones,
}: {
  milestones: PlayerJourneyMilestone[];
}) {
  if (milestones.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {milestones.map((milestone) => (
        <li
          key={milestone.key}
          className={
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
            (milestone.achieved
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-zinc-200 bg-zinc-50 text-zinc-400")
          }
          title={
            milestone.achieved && milestone.achievedDate
              ? new Date(milestone.achievedDate).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : undefined
          }
        >
          <span aria-hidden="true">{milestone.achieved ? "✓" : "○"}</span>
          <span>{milestone.label}</span>
          <span className="sr-only">
            {milestone.achieved ? " — achieved" : " — not yet achieved"}
          </span>
        </li>
      ))}
    </ul>
  );
}
