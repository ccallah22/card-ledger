import type { EvidenceState } from "@/lib/evidence/types";
import { formatEvidenceStateLabel } from "@/lib/evidence/formatEvidence";

// Vision Engine V3, Phase V3.3A: maps exactly the five EvidenceState values
// -- no additional states are invented here. Subtle, muted colors (a
// developer-tool aesthetic, not marketing UI); the TypeScript Record below
// also means an unhandled EvidenceState is a compile error, not a silent
// blank badge.
const STATE_STYLES: Record<EvidenceState, string> = {
  missing: "bg-zinc-100 text-zinc-500",
  supported: "bg-zinc-100 text-zinc-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  conflicted: "bg-amber-50 text-amber-800",
  user_overridden: "bg-blue-50 text-blue-700",
};

export function EvidenceStateBadge({ state }: { state: EvidenceState }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLES[state]}`}>
      {formatEvidenceStateLabel(state)}
    </span>
  );
}
