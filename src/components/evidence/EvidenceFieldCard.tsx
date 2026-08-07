"use client";

import { useState } from "react";
import type { EvidenceConflict, EvidenceField } from "@/lib/evidence/types";
import { EvidenceStateBadge } from "./EvidenceStateBadge";
import { EvidenceConfidenceBadge } from "./EvidenceConfidenceBadge";
import { EvidenceSourceBadge } from "./EvidenceSourceBadge";
import { EvidenceObservationList } from "./EvidenceObservationList";
import { EvidenceConflictCard } from "./EvidenceConflictCard";

// Vision Engine V3, Phase V3.3B: the plain-text override editor for a
// non-conflicted field. Local, ephemeral input-box state only -- nothing
// here touches FusedEvidence; it only calls `onSave` with an already-
// parsed, already-validated value once the user submits. Save is disabled
// while the current text doesn't parse into this field's value type (see
// EvidenceInspector's per-field parseInput), so an invalid override can
// never be submitted.
function ManualOverrideEditor({
  parseInput,
  onSave,
  onCancel,
}: {
  parseInput: (text: string) => unknown | null;
  onSave: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = parseInput(text);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Enter value"
        className="rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-800"
      />
      <button
        type="button"
        disabled={parsed === null}
        onClick={() => {
          if (parsed !== null) onSave(parsed);
        }}
        className="rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-700 hover:enabled:bg-zinc-100 disabled:opacity-40"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-zinc-500 underline">
        Cancel
      </button>
    </div>
  );
}

// Every distinct value present across a field's conflicting observations,
// deduplicated by its formatted display label -- one "Use <value>" button
// per distinct value, regardless of how many observations share it.
function distinctConflictValues(
  conflicts: EvidenceConflict<unknown>[],
  formatValue: (value: unknown) => string,
): { value: unknown; label: string }[] {
  const seen = new Map<string, unknown>();
  for (const conflict of conflicts) {
    for (const observation of conflict.observations) {
      const label = formatValue(observation.value);
      if (!seen.has(label)) seen.set(label, observation.value);
    }
  }
  return [...seen.entries()].map(([label, value]) => ({ value, label }));
}

const RESOLVE_EXPLANATION = "Manually resolved from conflicting evidence.";
const MANUAL_ENTRY_EXPLANATION = "Manually entered.";

// Vision Engine V3, Phase V3.3A/V3.3B: one collapsible card per FusedEvidence
// field. Local expand/collapse UI state only (useState) -- no mutation of
// `field` itself, no save behavior. Collapsed by default.
//
// Collapsed: field name, current resolved value, state/confidence/source
// badges (unchanged from V3.3A). Expanded: explanation, supporting
// observations, conflicts (if any) -- or, when the field is missing, a
// single "No evidence available." line instead of those (mostly-empty)
// sub-sections -- followed by V3.3B's override controls, which are always
// present regardless of state: a conflicted field offers one "Use <value>"
// button per distinct conflicting value (Resolve); any other non-overridden
// state offers a plain-text Override editor; an already-overridden field
// offers Remove Override. `onOverride`/`onRemoveOverride` update ONLY the
// page's local manualOverrides state (see cards/new/page.tsx) -- this
// component never talks to candidateEngine, candidateConfidence,
// variantCandidateEngine, or any save/persistence path.
export function EvidenceFieldCard({
  label,
  field,
  formatValue,
  parseInput,
  onOverride,
  onRemoveOverride,
}: {
  label: string;
  field: EvidenceField<unknown>;
  formatValue: (value: unknown) => string;
  parseInput: (text: string) => unknown | null;
  onOverride: (value: unknown, explanation: string) => void;
  onRemoveOverride: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-zinc-800">{label}</span>
          <span className="text-zinc-600">{formatValue(field.value)}</span>
          <EvidenceStateBadge state={field.state} />
          <EvidenceConfidenceBadge confidence={field.confidence} />
          <EvidenceSourceBadge source={field.primarySource} />
        </span>
        <span aria-hidden="true" className="text-zinc-400">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-zinc-100 px-2 py-2 text-zinc-600">
          {field.state === "missing" ? (
            <p className="text-zinc-400">No evidence available.</p>
          ) : (
            <>
              <p className="text-zinc-700">{field.explanation}</p>

              <div className="mt-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  Supporting observations
                </div>
                <EvidenceObservationList
                  observations={field.supportingObservations}
                  formatValue={formatValue}
                  currentValue={field.value}
                  currentSourceKind={field.primarySource?.kind}
                  conflictObservations={field.conflicts.flatMap((conflict) => conflict.observations)}
                />
              </div>

              {field.conflicts.length > 0 ? (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Conflicts
                  </div>
                  <div className="space-y-1.5">
                    {field.conflicts.map((conflict, index) => (
                      <EvidenceConflictCard key={index} conflict={conflict} formatValue={formatValue} />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="mt-2 border-t border-zinc-100 pt-2">
            {field.state === "user_overridden" ? (
              <button type="button" onClick={onRemoveOverride} className="text-red-600 underline">
                Remove Override
              </button>
            ) : field.state === "conflicted" ? (
              <>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Resolve</div>
                <div className="flex flex-wrap gap-1">
                  {distinctConflictValues(field.conflicts, formatValue).map(({ value, label: valueLabel }) => (
                    <button
                      key={valueLabel}
                      type="button"
                      onClick={() => onOverride(value, RESOLVE_EXPLANATION)}
                      className="rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100"
                    >
                      Use {valueLabel}
                    </button>
                  ))}
                </div>
              </>
            ) : isEditing ? (
              <ManualOverrideEditor
                parseInput={parseInput}
                onSave={(value) => {
                  onOverride(value, MANUAL_ENTRY_EXPLANATION);
                  setIsEditing(false);
                }}
                onCancel={() => setIsEditing(false)}
              />
            ) : (
              <button type="button" onClick={() => setIsEditing(true)} className="text-blue-700 underline">
                Override
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
