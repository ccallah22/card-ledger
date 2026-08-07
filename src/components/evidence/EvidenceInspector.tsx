import type { FusedEvidence } from "@/lib/evidence/types";
import {
  formatStringValue,
  formatPresenceValue,
  formatColorValue,
  formatSerialAreaValue,
} from "@/lib/evidence/formatEvidence";
import { EvidenceFieldCard } from "./EvidenceFieldCard";

// Vision Engine V3, Phase V3.3A: read-only rendering of an already-computed
// FusedEvidence object -- no editing, no mutation, no save behavior, no
// callbacks back to the caller. Never recomputes evidence; the caller
// (cards/new/page.tsx) passes the same fullFusedEvidence it already builds
// for variant ranking.
//
// Renders exactly the ten fields specified for this phase. The full
// FusedEvidence shape has more fields (teamName, brand, manufacturer,
// cardName, serialNumberText, orientation) -- deliberately not rendered
// yet; this is the initial Inspector, not a complete field dump.
export function EvidenceInspector({ evidence }: { evidence: FusedEvidence }) {
  return (
    <div className="text-xs text-zinc-700">
      <h3 className="font-semibold text-zinc-900">Evidence Inspector</h3>
      <div className="mt-2 space-y-1.5">
        <EvidenceFieldCard label="Player" field={evidence.playerName} formatValue={formatStringValue} />
        <EvidenceFieldCard label="Set" field={evidence.setName} formatValue={formatStringValue} />
        <EvidenceFieldCard label="Card Number" field={evidence.cardNumber} formatValue={formatStringValue} />
        <EvidenceFieldCard label="Year" field={evidence.year} formatValue={formatStringValue} />
        <EvidenceFieldCard label="Parallel" field={evidence.parallelText} formatValue={formatStringValue} />
        <EvidenceFieldCard label="Autograph" field={evidence.autographPresent} formatValue={formatPresenceValue} />
        <EvidenceFieldCard label="Memorabilia" field={evidence.memorabiliaPresent} formatValue={formatPresenceValue} />
        <EvidenceFieldCard label="Dominant Color" field={evidence.dominantColor} formatValue={formatColorValue} />
        <EvidenceFieldCard label="Border Color" field={evidence.borderColor} formatValue={formatColorValue} />
        <EvidenceFieldCard label="Serial Area" field={evidence.serialAreaVisible} formatValue={formatSerialAreaValue} />
      </div>
    </div>
  );
}
