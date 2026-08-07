import type { EvidenceSource } from "@/lib/evidence/types";
import { formatSourceKindLabel, NULL_VALUE_DISPLAY } from "@/lib/evidence/formatEvidence";

// Vision Engine V3, Phase V3.3A: `source` is nullable because a field's
// primarySource is null when EvidenceField.state is "missing" -- every
// per-observation source (EvidenceObservation.source) is always non-null.
// Never renders producerMetadata (provider/model identity) -- only the
// coarse source kind label.
export function EvidenceSourceBadge({ source }: { source: EvidenceSource | null }) {
  return (
    <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
      {source ? formatSourceKindLabel(source.kind) : NULL_VALUE_DISPLAY}
    </span>
  );
}
