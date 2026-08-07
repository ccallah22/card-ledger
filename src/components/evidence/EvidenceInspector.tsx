import type { EvidenceFieldName, EvidenceValueForField, FusedEvidence } from "@/lib/evidence/types";
import { COLOR_FAMILIES, type ColorFamily } from "@/lib/vision/types";
import {
  formatStringValue,
  formatPresenceValue,
  formatColorValue,
  formatSerialAreaValue,
} from "@/lib/evidence/formatEvidence";
import { EvidenceFieldCard } from "./EvidenceFieldCard";

// Vision Engine V3, Phase V3.3B: plain-text -> typed-value parsers for the
// manual override editor, one per value shape this Inspector renders.
// Return null for input that doesn't parse -- EvidenceFieldCard disables
// Save until the current text parses successfully, so an invalid override
// can never be created. Lives here (not in formatEvidence.ts) since these
// are UI-input-editing concerns, not general evidence-formatting ones, and
// this phase's file scope only calls for modifying this file (plus
// EvidenceFieldCard.tsx and page.tsx).

function parseStringInput(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePresenceInput(text: string): boolean | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "present") return true;
  if (normalized === "false" || normalized === "no" || normalized === "not present") return false;
  return null;
}

function parseSerialAreaInput(text: string): boolean | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "visible") return true;
  if (normalized === "false" || normalized === "no" || normalized === "not visible") return false;
  return null;
}

function parseColorInput(text: string): ColorFamily | null {
  const normalized = text.trim().toLowerCase();
  return (COLOR_FAMILIES as readonly string[]).includes(normalized) ? (normalized as ColorFamily) : null;
}

// Vision Engine V3, Phase V3.3A/V3.3B: renders an already-computed
// FusedEvidence object -- no recomputation. `onOverride`/`onRemoveOverride`
// only update the caller's local manualOverrides state (see
// cards/new/page.tsx); this component never calls candidateEngine,
// candidateConfidence, variantCandidateEngine, or any save/persistence
// path itself.
//
// Renders exactly the ten fields specified for V3.3A. The full
// FusedEvidence shape has more fields (teamName, brand, manufacturer,
// cardName, serialNumberText, orientation) -- deliberately not rendered
// yet; this is the initial Inspector, not a complete field dump.
export function EvidenceInspector({
  evidence,
  onOverride,
  onRemoveOverride,
}: {
  evidence: FusedEvidence;
  onOverride: <K extends EvidenceFieldName>(field: K, value: EvidenceValueForField<K>, explanation: string) => void;
  onRemoveOverride: (field: EvidenceFieldName) => void;
}) {
  return (
    <div className="text-xs text-zinc-700">
      <h3 className="font-semibold text-zinc-900">Evidence Inspector</h3>
      <div className="mt-2 space-y-1.5">
        <EvidenceFieldCard
          label="Player"
          field={evidence.playerName}
          formatValue={formatStringValue}
          parseInput={parseStringInput}
          onOverride={(value, explanation) => onOverride("playerName", value as string, explanation)}
          onRemoveOverride={() => onRemoveOverride("playerName")}
        />
        <EvidenceFieldCard
          label="Set"
          field={evidence.setName}
          formatValue={formatStringValue}
          parseInput={parseStringInput}
          onOverride={(value, explanation) => onOverride("setName", value as string, explanation)}
          onRemoveOverride={() => onRemoveOverride("setName")}
        />
        <EvidenceFieldCard
          label="Card Number"
          field={evidence.cardNumber}
          formatValue={formatStringValue}
          parseInput={parseStringInput}
          onOverride={(value, explanation) => onOverride("cardNumber", value as string, explanation)}
          onRemoveOverride={() => onRemoveOverride("cardNumber")}
        />
        <EvidenceFieldCard
          label="Year"
          field={evidence.year}
          formatValue={formatStringValue}
          parseInput={parseStringInput}
          onOverride={(value, explanation) => onOverride("year", value as string, explanation)}
          onRemoveOverride={() => onRemoveOverride("year")}
        />
        <EvidenceFieldCard
          label="Parallel"
          field={evidence.parallelText}
          formatValue={formatStringValue}
          parseInput={parseStringInput}
          onOverride={(value, explanation) => onOverride("parallelText", value as string, explanation)}
          onRemoveOverride={() => onRemoveOverride("parallelText")}
        />
        <EvidenceFieldCard
          label="Autograph"
          field={evidence.autographPresent}
          formatValue={formatPresenceValue}
          parseInput={parsePresenceInput}
          onOverride={(value, explanation) => onOverride("autographPresent", value as boolean, explanation)}
          onRemoveOverride={() => onRemoveOverride("autographPresent")}
        />
        <EvidenceFieldCard
          label="Memorabilia"
          field={evidence.memorabiliaPresent}
          formatValue={formatPresenceValue}
          parseInput={parsePresenceInput}
          onOverride={(value, explanation) => onOverride("memorabiliaPresent", value as boolean, explanation)}
          onRemoveOverride={() => onRemoveOverride("memorabiliaPresent")}
        />
        <EvidenceFieldCard
          label="Dominant Color"
          field={evidence.dominantColor}
          formatValue={formatColorValue}
          parseInput={parseColorInput}
          onOverride={(value, explanation) => onOverride("dominantColor", value as ColorFamily, explanation)}
          onRemoveOverride={() => onRemoveOverride("dominantColor")}
        />
        <EvidenceFieldCard
          label="Border Color"
          field={evidence.borderColor}
          formatValue={formatColorValue}
          parseInput={parseColorInput}
          onOverride={(value, explanation) => onOverride("borderColor", value as ColorFamily, explanation)}
          onRemoveOverride={() => onRemoveOverride("borderColor")}
        />
        <EvidenceFieldCard
          label="Serial Area"
          field={evidence.serialAreaVisible}
          formatValue={formatSerialAreaValue}
          parseInput={parseSerialAreaInput}
          onOverride={(value, explanation) => onOverride("serialAreaVisible", value as boolean, explanation)}
          onRemoveOverride={() => onRemoveOverride("serialAreaVisible")}
        />
      </div>
    </div>
  );
}
