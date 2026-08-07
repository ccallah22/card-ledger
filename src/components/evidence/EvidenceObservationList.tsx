import type { EvidenceObservation } from "@/lib/evidence/types";
import { EvidenceSourceBadge } from "./EvidenceSourceBadge";
import { EvidenceConfidenceBadge } from "./EvidenceConfidenceBadge";

// Vision Engine V3, Phase V3.3A: read-only, indented list of an
// EvidenceField's supportingObservations (or an EvidenceConflict's
// observations) -- rendered exactly in the order provided, never sorted or
// re-ranked here (that is fusion's job, already reflected in the order
// fuseEvidence produced).
export function EvidenceObservationList({
  observations,
  formatValue,
}: {
  observations: EvidenceObservation<unknown>[];
  formatValue: (value: unknown) => string;
}) {
  if (observations.length === 0) {
    return <p className="text-zinc-400">No supporting observations.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {observations.map((observation, index) => (
        <li key={index} className="border-l-2 border-zinc-200 pl-2">
          <div className="flex flex-wrap items-center gap-1">
            <EvidenceSourceBadge source={observation.source} />
            <span className="text-zinc-700">{formatValue(observation.value)}</span>
            <EvidenceConfidenceBadge confidence={observation.confidence} />
          </div>
          <p className="text-zinc-500">{observation.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
