import type { EvidenceObservation, EvidenceSourceKind } from "@/lib/evidence/types";
import {
  formatObservedAtTime,
  CURRENT_EVIDENCE_LABEL,
  MANUAL_OVERRIDE_LABEL,
  CONFLICTED_LABEL,
} from "@/lib/evidence/formatEvidence";
import { EvidenceSourceBadge } from "./EvidenceSourceBadge";
import { EvidenceConfidenceBadge } from "./EvidenceConfidenceBadge";

// Vision Engine V3, Phase V3.3C: a small vertical timeline -- one dot and
// connecting line segment per observation, oldest first. Never mutates
// `observations` (sorts a copy); never groups or deduplicates; shows
// exactly what evidence exists, exactly as fuseEvidence produced it.
//
// `currentValue`/`currentSourceKind`/`conflictObservations` are optional:
// when the caller (EvidenceFieldCard, for a field's full
// supportingObservations) supplies them, each event can show whether it is
// the field's current winner or part of an unresolved conflict.
// EvidenceConflictCard's own, narrower use (just a conflict's own
// observations) omits them and still renders correctly -- it simply gets a
// chronological list without those two badges (the ★ Manual Override badge
// needs no extra prop, since it is derivable from the observation alone).
export function EvidenceObservationList({
  observations,
  formatValue,
  currentValue,
  currentSourceKind,
  conflictObservations,
}: {
  observations: EvidenceObservation<unknown>[];
  formatValue: (value: unknown) => string;
  currentValue?: unknown;
  currentSourceKind?: EvidenceSourceKind;
  conflictObservations?: EvidenceObservation<unknown>[];
}) {
  if (observations.length === 0) {
    return <p className="text-zinc-400">No supporting observations.</p>;
  }

  // Copy before sorting -- never mutate the array fuseEvidence produced.
  const chronological = [...observations].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
  const conflictSet = new Set(conflictObservations ?? []);

  return (
    <ul>
      {chronological.map((observation, index) => {
        const isManualOverride = observation.source.kind === "manual_override";
        const isCurrentWinner =
          currentSourceKind !== undefined &&
          observation.source.kind === currentSourceKind &&
          observation.value === currentValue;
        const isConflicted = !isCurrentWinner && conflictSet.has(observation);
        const isLast = index === chronological.length - 1;

        return (
          <li key={index} className="flex gap-2">
            {/* Vision Engine V3 responsive fix (Phase 3A): shrink-0 keeps the
                dot/connector column a fixed small size regardless of how
                long the sibling content column's value/explanation gets. */}
            <div className="flex shrink-0 flex-col items-center">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  isManualOverride ? "bg-blue-500" : isCurrentWinner ? "bg-emerald-500" : "bg-zinc-300"
                }`}
              />
              {!isLast ? <span className="w-px flex-1 bg-zinc-200" /> : null}
            </div>
            {/* min-w-0 is required here even though this is already flex-1:
                flex-basis:0 alone does not remove a flex item's default
                min-width:auto, so without it a long unbroken value/
                explanation below could still force this column -- and the
                row/card/page -- wider than available space. */}
            <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-2"}`}>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-zinc-400">{formatObservedAtTime(observation.observedAt)}</span>
                <EvidenceSourceBadge source={observation.source} />
                <span className="min-w-0 break-words text-zinc-700">{formatValue(observation.value)}</span>
                <EvidenceConfidenceBadge confidence={observation.confidence} />
                {isManualOverride ? (
                  <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                    {MANUAL_OVERRIDE_LABEL}
                  </span>
                ) : null}
                {isCurrentWinner ? (
                  <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    {CURRENT_EVIDENCE_LABEL}
                  </span>
                ) : null}
                {isConflicted ? (
                  <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {CONFLICTED_LABEL}
                  </span>
                ) : null}
              </div>
              <p className="break-words text-zinc-500">{observation.explanation}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
