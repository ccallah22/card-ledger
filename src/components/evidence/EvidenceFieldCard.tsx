"use client";

import { useState } from "react";
import type { EvidenceField } from "@/lib/evidence/types";
import { EvidenceStateBadge } from "./EvidenceStateBadge";
import { EvidenceConfidenceBadge } from "./EvidenceConfidenceBadge";
import { EvidenceSourceBadge } from "./EvidenceSourceBadge";
import { EvidenceObservationList } from "./EvidenceObservationList";
import { EvidenceConflictCard } from "./EvidenceConflictCard";

// Vision Engine V3, Phase V3.3A: one collapsible, read-only card per
// FusedEvidence field. Local expand/collapse UI state only (useState) --
// no prop-based callback into the page, no mutation of `field` or any app
// state, no save behavior. Collapsed by default.
//
// Collapsed: field name, current resolved value, state/confidence/source
// badges. Expanded: explanation, supporting observations, conflicts (if
// any) -- or, when the field is missing, a single "No evidence available."
// line instead of those (mostly-empty) sub-sections.
export function EvidenceFieldCard({
  label,
  field,
  formatValue,
}: {
  label: string;
  field: EvidenceField<unknown>;
  formatValue: (value: unknown) => string;
}) {
  const [expanded, setExpanded] = useState(false);

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
                <EvidenceObservationList observations={field.supportingObservations} formatValue={formatValue} />
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
        </div>
      ) : null}
    </div>
  );
}
