import type { EvidenceConflict } from "@/lib/evidence/types";
import { EvidenceObservationList } from "./EvidenceObservationList";

type ConflictSeverity = EvidenceConflict<unknown>["severity"];

// Vision Engine V3, Phase V3.3A: subtle severity styling only -- no
// buttons, no resolve/accept actions (read-only, this phase).
const SEVERITY_STYLES: Record<ConflictSeverity, string> = {
  informational: "border-zinc-200 bg-zinc-50",
  moderate: "border-amber-200 bg-amber-50",
  severe: "border-red-200 bg-red-50",
};

const SEVERITY_LABELS: Record<ConflictSeverity, string> = {
  informational: "Informational conflict",
  moderate: "Moderate conflict",
  severe: "Severe conflict",
};

export function EvidenceConflictCard({
  conflict,
  formatValue,
}: {
  conflict: EvidenceConflict<unknown>;
  formatValue: (value: unknown) => string;
}) {
  return (
    <div className={`rounded border p-2 ${SEVERITY_STYLES[conflict.severity]}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {SEVERITY_LABELS[conflict.severity]}
      </span>
      {conflict.suggestedResolution !== null ? (
        <p className="mt-1 break-words text-zinc-700">
          Suggested resolution: {formatValue(conflict.suggestedResolution)}
        </p>
      ) : null}
      {conflict.suggestedResolutionReason ? (
        <p className="break-words text-zinc-500">{conflict.suggestedResolutionReason}</p>
      ) : null}
      <div className="mt-1.5">
        <EvidenceObservationList observations={conflict.observations} formatValue={formatValue} />
      </div>
    </div>
  );
}
