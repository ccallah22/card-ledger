"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { GradingStatus, CardStatus } from "@/lib/types";
import { type MyCardInput, createMyCard } from "@/lib/repositories/myCards";
import {
  searchCatalog,
  getCardWithContext,
  type CardWithContext,
  type CardSummary,
} from "@/lib/repositories/cards";
import { findSetBySlug } from "@/lib/repositories/sets";
import type { ChecklistSectionRow } from "@/lib/repositories/checklistSections";

// The exact set/section/card hierarchy resolved from a URL-provided
// catalogCardId (see the "Search -> Add to Collection" bootstrap below),
// used to drive that hierarchy's staged preselection one level at a time.
type CatalogPreselectTarget = {
  setId: number;
  // Full section row, or null for a legitimately sectionless card
  // (checklist_section_id is still nullable during the Catalog v2
  // migration -- see cards.ts's CardRow comment) -- never a fake/invented
  // section.
  sectionRow: ChecklistSectionRow | null;
  cardSummary: CardSummary;
};
import { slugify } from "@/lib/slug";
import { listLocations } from "@/lib/repositories/locations";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { saveSharedImage } from "@/lib/db/sharedImages";
import { saveImageForCard, saveThumbnailForCard } from "@/lib/imageStore";
import {
  upsertCardMediaBySide,
  getCardMediaBySide,
  updateCardMedia,
  type JsonValue,
} from "@/lib/repositories/cardMedia";
import { uploadCardMediaImage } from "@/lib/db/cardMediaStorage";
import type { ChecklistEntry } from "@/lib/db/checklists.client";
import {
  applySectionAutoFill,
  inferFlagsFromSection,
  toNum,
} from "@/lib/checklists/autofill";
import { Field, Select, Check } from "@/components/forms/FormControls";
import { useSetLookup, formatSetLabel } from "@/hooks/cards/useSetLookup";
import { useChecklistLookup } from "@/hooks/cards/useChecklistLookup";
import { useChecklistSectionLookup } from "@/hooks/cards/useChecklistSectionLookup";
import { useCatalogCardLookup } from "@/hooks/cards/useCatalogCardLookup";
import { useCatalogVariantLookup } from "@/hooks/cards/useCatalogVariantLookup";
import { useCardImageSlot } from "@/hooks/cards/useCardImageSlot";
import { useSharedImageLookup } from "@/hooks/cards/useSharedImageLookup";
import { CardImageUploader } from "@/components/cards/CardImageUploader";
import { CardImageCropModal } from "@/components/cards/CardImageCropModal";
import { runOcr, toLegacyOcrResult, type CardOcrResult } from "@/lib/ocr";
import { mergeCardOcrResults, type MergedCardOcrResult } from "@/lib/ocr/merge";
import { runVisionAnalysis, type CardVisionAnalysis, type VisionImageSide } from "@/lib/vision";
import { isCardVisionAnalysis } from "@/lib/vision/validateVisionAnalysis";
import { VISION_ANALYSIS_VERSION } from "@/lib/vision/types";
import { getImageRetakeGuidance } from "@/lib/vision/formatObservations";
import { takePendingScanImage, PENDING_SCAN_IMAGE_EVENT } from "@/lib/pendingScanImage";
import { findCatalogCandidates, type CatalogCandidate } from "@/lib/catalog/candidateEngine";
import { buildFusedEvidence } from "@/lib/evidence/buildFusedEvidence";
import { applyManualOverrides, type ManualOverridesByField } from "@/lib/evidence/manualOverrides";
import type { EvidenceFieldName, EvidenceValueForField } from "@/lib/evidence/types";
import { replaceManualEvidenceOverrides } from "@/lib/repositories/manualEvidenceOverrides";
import { rankCardVariants, type VariantCandidate } from "@/lib/catalog/variantCandidateEngine";
import { listCardVariantsForCard, type CardVariantSummary } from "@/lib/repositories/cardVariants";
import {
  assessCandidateConfidence,
  type CandidateConfidenceAssessment,
} from "@/lib/catalog/candidateConfidence";
import { buildCatalogQuery } from "@/lib/catalog/queryBuilder";
import { rankCatalogMatches } from "@/lib/catalog/rankingEngine";
import { shouldAutoSelect } from "@/lib/catalog/autoSelect";

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

// Add Card scan UX simplification, Phase C: the display-only label maps
// that used to render the Top Candidate panel's recommendation word and
// per-field quality summary (RECOMMENDATION_LABELS, IMPORTANT_CONFIDENCE_
// FIELDS, CONFIDENCE_FIELD_LABELS) were removed here -- the normal-path
// "Card identified" summary no longer surfaces score/confidence/
// recommendation/field-quality at all (see CandidateSummary below). The
// underlying data these labels used to format (confidenceAssessments,
// computed via assessCandidateConfidence) is untouched and still fully
// computed; only its normal-UI rendering and these now-unused label maps
// were deleted, consistent with this phase's "hide, don't duplicate"
// principle.

// Vision Engine V2, Phase 7C: pure, exported-for-testability helpers for
// safe candidate preselection. Kept outside the component so they can be
// exercised directly by a throwaway verification script without rendering
// React -- neither reads component state, both take everything as
// arguments, and neither has any side effect.

// Builds a stable identity for the current candidate-search cycle from
// only the merged OCR fields that actually drive candidate lookup/scoring
// (see candidateEngine.ts's WEIGHTS / candidateConfidence.ts's
// FIELD_DEFINITIONS). Two mergedOcr values with the same underlying
// evidence for these seven fields always produce the same key, even if
// mergedOcr's own object identity or unrelated fields (conflictCount,
// createdAt, teamName, etc.) differ.
export function buildSearchCycleKey(merged: MergedCardOcrResult): string {
  return [
    merged.fields.playerName.value,
    merged.fields.cardNumber.value,
    merged.fields.setName.value,
    merged.fields.year.value,
    merged.fields.brand.value ?? merged.fields.manufacturer.value,
    merged.fields.parallelText.value,
    merged.fields.cardName.value,
  ]
    .map((v) => v ?? "")
    .join("|");
}

export type CandidateAutoSelectContext = {
  isWishlistCard: boolean;
  hasSelectedCandidate: boolean;
  hasManualInteraction: boolean;
  alreadyAutoSelectedThisCycle: boolean;
  candidatesResolvedForCurrentCycle: boolean;
  topAssessment: CandidateConfidenceAssessment | undefined;
};

// The single decision of whether automatic preselection is currently
// permitted. Every gate is a separate, named condition rather than one
// combined boolean expression, so each required-behavior case (recommendation
// handling, already-selected, manual interaction, missing identity evidence)
// can be verified independently.
export function shouldAutoSelectCandidate(ctx: CandidateAutoSelectContext): boolean {
  if (ctx.isWishlistCard) return false;
  if (ctx.hasSelectedCandidate) return false;
  if (ctx.hasManualInteraction) return false;
  if (ctx.alreadyAutoSelectedThisCycle) return false;
  if (!ctx.candidatesResolvedForCurrentCycle) return false;

  const top = ctx.topAssessment;
  if (!top) return false;
  // Recommendation handling: only "safe_to_preselect" ever auto-selects.
  // strong_match / review / insufficient_evidence never do, regardless of
  // confidence value.
  if (top.recommendation !== "safe_to_preselect") return false;

  // Re-checked directly here (not just trusted from the recommendation)
  // so malformed upstream data can never cause an auto-select without
  // genuine player + card number identity evidence.
  const playerField = top.fieldAssessments.find((f) => f.field === "player");
  const cardNumberField = top.fieldAssessments.find((f) => f.field === "cardNumber");
  if (!playerField || playerField.quality === "missing") return false;
  if (!cardNumberField || cardNumberField.quality === "missing") return false;

  return true;
}

// Add Card scan UX simplification, Phase I (automatic top-candidate
// application): a NEW, separate decision from shouldAutoSelectCandidate
// above -- that function (and the CandidateConfidenceAssessment/
// safe_to_preselect machinery it reads) is deliberately left completely
// unmodified and still fully computed (see confidenceAssessments in
// NewCardPageInner), it simply no longer gates the page's automatic-
// application effect. The product decision this phase implements is
// "automatic first attempt + easy correction": once a search cycle has
// produced at least one ranked candidate, the top-ranked one
// (candidateResults[0] -- ranking/retrieval themselves are untouched)
// becomes the working selection immediately, with no confidence/
// recommendation threshold gating it at all. Every other guard
// shouldAutoSelectCandidate already had EXCEPT the confidence/
// recommendation/field-quality checks is preserved unchanged here, for
// the same reasons as before: never act on a wishlist card, never
// override an already-selected candidate, never fight a user's explicit
// interaction during the current search cycle, never act twice for the
// same cycle, and never act on a stale (still-resolving) candidate list.
export type CandidateAutoApplyContext = {
  isWishlistCard: boolean;
  hasSelectedCandidate: boolean;
  hasManualInteraction: boolean;
  alreadyAutoAppliedThisCycle: boolean;
  candidatesResolvedForCurrentCycle: boolean;
  hasCandidates: boolean;
};

export function shouldAutoApplyTopCandidate(ctx: CandidateAutoApplyContext): boolean {
  if (ctx.isWishlistCard) return false;
  if (ctx.hasSelectedCandidate) return false;
  if (ctx.hasManualInteraction) return false;
  if (ctx.alreadyAutoAppliedThisCycle) return false;
  if (!ctx.candidatesResolvedForCurrentCycle) return false;
  // The only "is there anything to apply" condition -- deliberately NOT a
  // confidence/recommendation check. A genuine catalog match existing at
  // all (candidateResults.length > 0) is now sufficient; how trustworthy
  // that top match is remains available internally (confidenceAssessments)
  // but is no longer a precondition for applying it. Step 13's zero-
  // candidate case is exactly ctx.hasCandidates === false here.
  if (!ctx.hasCandidates) return false;

  return true;
}

// Vision Engine V3, Phase V3.1B: resolves the visual-analysis result (if
// any) that is safe to persist for one side at save time. Exported,
// side-effect-free (never touches component state directly) so it can be
// exercised by a throwaway verification script without rendering React,
// matching buildSearchCycleKey/shouldAutoSelectCandidate's pattern above.
//
// Bounded wait: if the cached result doesn't already match the current
// image (still analyzing, or never started for this exact crop), and an
// in-flight request for this side exists, waits up to VISION_SAVE_WAIT_MS
// for it -- via Promise.race against a timeout, never indefinitely -- so a
// slow model response can never hang Save. A rejected in-flight request is
// swallowed here (.catch(() => null)) since a vision failure must never
// throw out of the save cycle.
//
// Persistence safety gates (all must pass): the result must belong to the
// exact current image (imageKey match -- guards against a stale result
// from a since-replaced/removed image), declare the expected side, declare
// a supported analysisVersion, and pass isCardVisionAnalysis's full
// structural re-validation. Any failure returns null -- callers must then
// skip persistence entirely for this side/cycle rather than write anything.
const VISION_SAVE_WAIT_MS = 8000;

export async function resolveVisionResultForSave(params: {
  imageUrl: string;
  side: VisionImageSide;
  cachedResult: CardVisionAnalysis | null;
  cachedImageKey: string | null;
  inFlightRequest: Promise<CardVisionAnalysis> | null;
}): Promise<CardVisionAnalysis | null> {
  let result = params.cachedResult;
  let resultKey = params.cachedImageKey;

  if ((!result || resultKey !== params.imageUrl) && params.inFlightRequest) {
    const awaited = await Promise.race([
      params.inFlightRequest.catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), VISION_SAVE_WAIT_MS);
      }),
    ]);
    if (awaited) {
      result = awaited;
      resultKey = params.imageUrl;
    }
  }

  if (!result || resultKey !== params.imageUrl) return null;
  if (result.side !== params.side) return null;
  if (result.analysisVersion !== VISION_ANALYSIS_VERSION) return null;
  if (!isCardVisionAnalysis(result, params.side)) return null;

  return result;
}

// Add Card presentation cleanup: this used to also report "done" states
// ("Front text detected" / "No readable text detected") -- those were
// internal diagnostics with no action for a collector to take, so a
// successful (or successfully-empty) OCR attempt is now silent. Only two
// states are ever worth a collector's attention: OCR is actively running
// (brief, temporary "Reading…" feedback), or it genuinely failed, in which
// case manual entry is still available -- the message says so, without
// naming OCR/providers/internals. frontOcrResult/backOcrResult themselves,
// and every downstream consumer (mergedOcr, fullFusedEvidence, candidate
// search), are completely unaffected -- this only changes what renders.
function ocrStatusLabel(
  side: "front" | "back",
  status: "idle" | "running" | "done" | "failed",
): string {
  if (status === "running") return `Reading ${side}…`;
  if (status === "failed") {
    return "Couldn't read this photo automatically. You can still enter the card details below.";
  }
  return "";
}

// Add Card scan UX simplification, Phase E: the technical, always-visible
// "Visual Analysis" report (dominant/border color, glare, lighting,
// orientation, a raw quality summary, warnings) that used to render here
// via a VisualAnalysisSide component was removed -- collectors don't need
// a technical image-quality report; TheBinder does, internally (see
// getImageRetakeGuidance in src/lib/vision/formatObservations.ts, and
// displayEvidence/rankCardVariants, both of which still consume
// frontVisionResult/backVisionResult exactly as before). Only the one
// user-facing signal worth surfacing -- a concise retake instruction when
// the photo genuinely can't be scanned reliably -- is now shown, directly
// under each side's own uploader (see the JSX below), never as a
// separate combined panel.

/**
 * Add Card scan UX simplification, Phase C: concise, collector-facing
 * canonical-identity line for one candidate -- set/year, checklist section
 * (when present and non-base), player/card number, and parallel (when the
 * candidate actually has one). Deliberately never renders score,
 * confidence, recommendation, or per-field quality -- those remain
 * internal (still fully computed; see confidenceAssessments in
 * NewCardPageInner) and are not part of this normal-path summary. Shared
 * by the "Card identified" summary and each row in the alternatives
 * chooser so both present identical fields/formatting.
 */
function CandidateSummary({ candidate }: { candidate: CatalogCandidate }) {
  return (
    <>
      <div>{[candidate.setName, candidate.year].filter(Boolean).join(" ")}</div>
      {candidate.checklistSectionName && candidate.checklistSectionCategory !== "base" ? (
        <div className="font-medium text-zinc-800">{candidate.checklistSectionName}</div>
      ) : null}
      <div>
        {candidate.playerName ?? candidate.cardTitle}
        {candidate.cardNumber ? ` #${candidate.cardNumber}` : ""}
        {candidate.parallel ? ` • ${candidate.parallel}` : ""}
      </div>
    </>
  );
}

// Add Card scan UX simplification, Phase F: the closed set of FusedEvidence
// fields that actually drive card IDENTITY -- exactly the fields
// candidateEngine.ts's WEIGHTS / candidateConfidence.ts's FIELD_DEFINITIONS
// score when ranking/assessing a candidate card (player, cardNumber, set,
// year, cardName, parallel, brand), restricted to code semantics rather
// than the old Evidence Inspector's own field list. A conflict on any
// OTHER field (teamName, manufacturer, autographPresent, memorabiliaPresent,
// serialNumberText, serialAreaVisible, dominantColor, borderColor,
// orientation) never appears in the identity-conflict prompt below --
// resolving those never changes which catalog card this is, so they stay
// purely internal (still fully available to variant ranking/future
// reference work via displayEvidence, untouched by this phase). Typed as
// a closed literal union (not the broader EvidenceFieldName) specifically
// so every field here is guaranteed to be an EvidenceField<string> --
// see applyIdentityConflictResolution below, which relies on that.
type IdentityEvidenceFieldName =
  | "playerName"
  | "cardNumber"
  | "setName"
  | "year"
  | "cardName"
  | "parallelText"
  | "brand";

const IDENTITY_CONFLICT_FIELDS: { field: IdentityEvidenceFieldName; label: string }[] = [
  { field: "playerName", label: "Player" },
  { field: "cardNumber", label: "Card Number" },
  { field: "setName", label: "Set" },
  { field: "year", label: "Year" },
  { field: "cardName", label: "Card Name" },
  { field: "parallelText", label: "Parallel" },
  { field: "brand", label: "Brand" },
];

function NewCardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWishlist = searchParams.get("wishlist") === "1";
  const isForSaleIntent = searchParams.get("forSale") === "1";
  // "Search -> Add to Collection": present only when this page was reached
  // via a catalog card's "Add to My Collection" link
  // (/cards/new?catalogCardId=<cards.id>). Read independently of
  // wishlist/forSale/mode above -- each of these composes with the others,
  // none replaces another.
  const catalogCardIdParam = searchParams.get("catalogCardId");

  // Mobile-only "Scan Card" / "Enter Manually" entry choice. Desktop always
  // shows the form regardless of this state (see the className toggles
  // below), so the default here only matters for the mobile-width case.
  //
  // The center mobile bottom-nav Add Card button (AppShell.tsx) links here
  // with ?mode=scan so that entry point skips this choice screen and lands
  // straight on the scan/photo form -- initialModeIsScan seeds entryMode
  // directly on first render (not via a useState-resetting effect), so it
  // only ever affects the INITIAL value and can never override a later,
  // intentional switch to manual entry in the same visit. This intentionally
  // does NOT also auto-click the camera input: browsers can require file/
  // camera input activation to happen synchronously from a genuine user
  // gesture, which a useEffect firing after navigation isn't guaranteed to
  // count as. The user still taps the existing scan/photo control themselves
  // once they land here -- only the "which screen do they land on" choice is
  // skipped, not the tap-to-open-camera interaction itself.
  const initialModeIsScan = searchParams.get("mode") === "scan";
  const [entryMode, setEntryMode] = useState<"choice" | "form">(
    initialModeIsScan ? "form" : "choice"
  );
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const profileId = await requireProfileId();
        const locations = await listLocations(profileId);
        setLocationOptions(locations.map((l) => l.name).sort((a, b) => a.localeCompare(b)));
      } catch {
        // ignore
      }
    })();
  }, []);

  const [playerName, setPlayerName] = useState("");
  const [year, setYear] = useState("");
  const [setName, setSetName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [team, setTeam] = useState("");
  const {
    setQuery,
    setSetQuery,
    showSetResults,
    setShowSetResults,
    setEntries,
    setResults,
    selectSet,
  } = useSetLookup({ setYear, setSetName });

  // Catalog v2 section lookup foundation: resolves the real catalog set id
  // from year+setName (whichever path filled them -- useSetLookup's
  // selectSet or the catalog-match auto-fill both converge on these same
  // two fields), then loads that set's checklist sections. Selecting a
  // section only updates local state for now -- it is not wired into
  // buildCard()/createMyCard yet.
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const trimmedYear = year.trim();
    const trimmedSetName = setName.trim();

    if (!trimmedYear || !trimmedSetName) {
      setSelectedSetId(null);
      return;
    }

    const slug = slugify(`${trimmedSetName}-${trimmedYear}`);
    findSetBySlug(slug)
      .then((set) => {
        if (active) setSelectedSetId(set?.id ?? null);
      })
      .catch(() => {
        if (active) setSelectedSetId(null);
      });

    return () => {
      active = false;
    };
  }, [year, setName]);

  const {
    sections: checklistSectionOptions,
    loading: checklistSectionsLoading,
    selectedSection,
    setSelectedSection,
  } = useChecklistSectionLookup(selectedSetId);

  const {
    cards: catalogCardOptions,
    loading: catalogCardsLoading,
    query: catalogCardQuery,
    setQuery: setCatalogCardQuery,
    selectedCard,
    setSelectedCard,
  } = useCatalogCardLookup(selectedSection?.id ?? null);
  const [showCatalogCardResults, setShowCatalogCardResults] = useState(false);

  const {
    variants: catalogVariantOptions,
    loading: catalogVariantsLoading,
    query: catalogVariantQuery,
    setQuery: setCatalogVariantQuery,
    setSelectedVariant,
  } = useCatalogVariantLookup(selectedCard?.id ?? null);
  const [showCatalogVariantResults, setShowCatalogVariantResults] = useState(false);

  const [catalogQuery, setCatalogQuery] = useState("");
  const [debouncedCatalogQuery, setDebouncedCatalogQuery] = useState("");
  const [showCatalogResults, setShowCatalogResults] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CardWithContext[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Selecting a result (manually or via auto-select) rewrites catalogQuery
  // to display what was picked, which would otherwise retrigger this same
  // debounced search and unconditionally reopen a dropdown the user (or
  // auto-select's own field-fill) just intentionally closed/left alone.
  // Set right before that rewrite so the one resulting search cycle skips
  // reopening the dropdown and re-running auto-select.
  const suppressNextDropdownOpenRef = useRef(false);

  // useCallback with an empty dependency array: every setter this touches
  // is a plain useState setter (guaranteed stable), and the function reads
  // nothing else from render scope -- only its own `result` argument -- so
  // its true dependencies are empty. This gives it a stable identity across
  // renders, which both the catalog search effect below and the
  // catalogCardId bootstrap effect further down need to be able to list it
  // as a dependency without retriggering on every render. Declared here
  // (before the search effect that references it in its dependency array)
  // rather than nearer selectCatalogMatch below, since a dependency array
  // is evaluated at render time and referencing a not-yet-initialized
  // const there -- unlike inside a closure body that only runs later --
  // would throw.
  // Identity-ownership fix (Phase B): year/setName used to only ever be SET
  // (if result.X), never cleared -- a stale value from whatever the field
  // held before this match (a prior candidate, a prior legacy match, or a
  // manual edit) could silently survive if this particular result happened
  // to lack that field. Unconditional now, matching playerName/cardNumber's
  // existing (already-correct) unconditional assignment just below.
  const fillFieldsFromCatalogMatch = useCallback((result: CardWithContext) => {
    setPlayerName(result.playerNames.join(" / "));
    setYear(result.releaseYear != null ? String(result.releaseYear) : "");
    setSetName(result.setName ?? "");
    setCardNumber(result.cardNumber);
    setIsRookie(result.rookieCard);
    setIsAutograph(result.isAutograph);
    setIsPatch(result.isMemorabilia);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCatalogQuery(catalogQuery), 150);
    return () => clearTimeout(t);
  }, [catalogQuery]);

  useEffect(() => {
    let active = true;
    const trimmed = debouncedCatalogQuery.trim();
    const suppressOpen = suppressNextDropdownOpenRef.current;
    suppressNextDropdownOpenRef.current = false;

    if (!trimmed) {
      setCatalogResults([]);
      setCatalogLoading(false);
      return;
    }

    setCatalogLoading(true);
    searchCatalog(trimmed)
      .then((results) => {
        if (!active) return;
        const ranked = rankCatalogMatches(trimmed, results);
        setCatalogResults(ranked);
        // Add Card scan UX simplification: this legacy free-text search is
        // still triggered programmatically from raw OCR text regardless of
        // whether a scan candidate has already been identified (see the
        // OCR-completion effect that calls setCatalogQuery), but once
        // selectedCandidate exists, TheBinder already has a confirmed exact
        // identity -- this superseded search's own dropdown (including its
        // "No cards found." empty state) must not reveal itself underneath
        // an already-successful "Card identified" result and contradict it.
        // Gated here, at the one place that reveals the dropdown, rather
        // than by touching searchCatalog/rankCatalogMatches themselves.
        // Deliberately does NOT gate the input's own onFocus/onChange
        // handlers below -- the user can still deliberately click into this
        // box and search it manually at any time, candidate or not.
        if (!suppressOpen && !selectedCandidate) {
          // Reveal the dropdown once a search actually completes, not just
          // on manual focus/typing -- otherwise a programmatically-set
          // query (e.g. from OCR) fetches/ranks results correctly but
          // never shows them, since showCatalogResults would still be
          // false.
          setShowCatalogResults(true);
          // Auto-fill only when the top match is unambiguous (unique exact
          // card number plus a corroborating exact player/set match). This
          // only fills fields -- it deliberately leaves catalogQuery and
          // the dropdown untouched, so the user can still see and pick a
          // different result if this guessed wrong.
          //
          // Identity-ownership fix (Phase B): also only when no manually
          // selected catalog card is already active (selectedCandidate is
          // already excluded by the outer guard above). An explicit manual
          // pick (selectCatalogMatch below) is unaffected by this guard,
          // since an explicit user action should always be able to replace
          // whatever was active before.
          if (!selectedCard && shouldAutoSelect(trimmed, ranked)) {
            fillFieldsFromCatalogMatch(ranked[0]);
          }
        }
      })
      .catch(() => {
        if (!active) return;
        setCatalogResults([]);
        if (!suppressOpen && !selectedCandidate) setShowCatalogResults(true);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
    // selectedCandidate/selectedCard are deliberately read but not listed:
    // they only gate what an already-triggered search is allowed to do once
    // it resolves, and must never themselves cause this effect to re-run a
    // fresh searchCatalog() fetch (that would refetch/re-show the dropdown
    // every time a candidate is selected/cleared, with no query change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCatalogQuery, fillFieldsFromCatalogMatch]);

  function selectCatalogMatch(result: CardWithContext) {
    // Identity-ownership fix (Phase B): an explicit legacy free-text pick is
    // itself a fresh exact-identity choice (same principle as the manual
    // Set/Section/Card dropdown) -- demote any active scan candidate or
    // manual card selection first, so buildCard()'s Phase A precedence
    // can't keep pointing at a stale exact id while these text fields now
    // show a different match.
    clearSelectedCandidate();
    setSelectedCard(null);
    fillFieldsFromCatalogMatch(result);
    suppressNextDropdownOpenRef.current = true;
    setCatalogQuery(`${result.cardNumber} ${result.playerNames.join(" / ")}`.trim());
    setShowCatalogResults(false);
  }

  // ---- "Search -> Add to Collection" catalog preselection bootstrap ----
  // If this page was reached via a catalog card's "Add to My Collection"
  // link (/cards/new?catalogCardId=<cards.id>), this resolves that exact
  // catalog card once on mount and establishes the same
  // selectedSetId/selectedSection/selectedCard hierarchy manual lookup
  // would have produced -- reusing fillFieldsFromCatalogMatch for the
  // plain text fields (the fields that actually flow into buildCard()/
  // save) and the existing useChecklistSectionLookup/useCatalogCardLookup/
  // useCatalogVariantLookup hooks for the rest (selectedSection/
  // selectedCard themselves are UI-tracking/variant-lookup-triggering
  // state that also makes the variant lookup fetch/become available and
  // shows the right section/card as already-selected -- setting them here
  // reproduces exactly what the manual dropdowns below already do.
  // selectedCard additionally feeds Phase A's catalogCardId precedence
  // (selectedCandidate?.cardId ?? selectedCard?.id) once no scan candidate
  // is active, same as a manual pick from those dropdowns. Absent entirely
  // when catalogCardId isn't in the URL: normal manual /cards/new behavior
  // is unchanged.
  const [catalogPreselectStatus, setCatalogPreselectStatus] = useState<
    "idle" | "loading" | "error" | "applied"
  >("idle");

  // Refs, not state: this is one-time bootstrap bookkeeping the render
  // never needs to read, and a ref lets the effects below check it without
  // needing it as a dependency.
  const catalogPreselectTargetRef = useRef<CatalogPreselectTarget | null>(null);
  // Guards each stage to fire exactly once for this target. Once "done",
  // none of the three effects below ever call these setters again, so a
  // later manual selection change is never forced back to the URL's card
  // (the "one-time guard" this bootstrap is built around).
  const catalogPreselectStageRef = useRef<
    "pending-set" | "pending-section" | "pending-card" | "done"
  >("pending-set");

  // Stage 0 (mount-only): resolve the catalog card, fill the plain text
  // fields exactly like selecting a manual catalog match already does, and
  // kick off the set side of the hierarchy.
  useEffect(() => {
    if (!catalogCardIdParam) return;
    const numericId = Number(catalogCardIdParam);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setCatalogPreselectStatus("error");
      return;
    }

    let active = true;
    setCatalogPreselectStatus("loading");
    getCardWithContext(numericId)
      .then((found) => {
        if (!active) return;
        if (!found) {
          setCatalogPreselectStatus("error");
          return;
        }
        fillFieldsFromCatalogMatch(found);
        catalogPreselectTargetRef.current = {
          setId: found.setId,
          sectionRow: found.checklistSection,
          cardSummary: { id: found.id, card_number: found.cardNumber, title: found.title },
        };
        catalogPreselectStageRef.current = "pending-section";
        setSelectedSetId(found.setId);
        setCatalogPreselectStatus("applied");
      })
      .catch(() => {
        if (active) setCatalogPreselectStatus("error");
      });

    return () => {
      active = false;
    };
  }, [catalogCardIdParam, fillFieldsFromCatalogMatch]);

  // Stage 1: once selectedSetId reflects the resolved target set, apply the
  // section half of the hierarchy. Deferred to its own effect (not called
  // synchronously alongside setSelectedSetId above) so it runs strictly
  // after useChecklistSectionLookup's own render-time reset-on-set-change
  // has already resolved -- calling setSelectedSection in the same tick as
  // the setId change would race that reset and could be clobbered by it.
  //
  // A sectionless target (sectionRow === null) is handled entirely in this
  // stage rather than deferred to Stage 2: selectedSection already starts
  // at null (useChecklistSectionLookup's own initial state), so
  // setSelectedSection(null) here is a no-op React bails out of re-rendering
  // for -- Stage 2's effect would then never see selectedSection "change"
  // and would never fire. Since useCatalogCardLookup's controlling id
  // (selectedSection?.id ?? null) is null both before and after in this
  // case, there's no render-time reset to race against anyway, so it's
  // safe to set the card directly here instead of waiting a stage.
  useEffect(() => {
    const target = catalogPreselectTargetRef.current;
    if (!target) return;
    if (catalogPreselectStageRef.current !== "pending-section") return;
    if (selectedSetId !== target.setId) return;

    setSelectedSection(target.sectionRow);
    if (target.sectionRow === null) {
      setSelectedCard(target.cardSummary);
      catalogPreselectStageRef.current = "done";
    } else {
      catalogPreselectStageRef.current = "pending-card";
    }
  }, [selectedSetId, setSelectedSection, setSelectedCard]);

  // Stage 2: once selectedSection reflects the resolved target section,
  // apply the exact catalog card. Set directly via setSelectedCard rather
  // than waiting for it to appear in catalogCardOptions (the section's own
  // fetched list) -- this runs strictly after useCatalogCardLookup's own
  // render-time reset-on-section-change has already resolved, avoiding the
  // same race Stage 1 avoids relative to Stage 0. No variant is selected
  // here; useCatalogVariantLookup's own effect fetches this card's variants
  // once selectedCard is set, and the user picks one manually, same as any
  // other card.
  useEffect(() => {
    const target = catalogPreselectTargetRef.current;
    if (!target) return;
    if (catalogPreselectStageRef.current !== "pending-card") return;
    if (!target.sectionRow) return;
    if (selectedSection?.id !== target.sectionRow.id) return;

    setSelectedCard(target.cardSummary);
    catalogPreselectStageRef.current = "done";
  }, [selectedSection, setSelectedCard]);

  // ✅ NEW
  const [location, setLocation] = useState("");
  const [locationOptions, setLocationOptions] = useState<string[]>([]);

  const [gradingStatus, setGradingStatus] = useState<GradingStatus>("RAW");
  const [grader, setGrader] = useState("");
  const [grade, setGrade] = useState("");

  const [status, setStatus] = useState<CardStatus>("HAVE");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [marketValue, setMarketValue] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState<string>("");

  // ✅ Collector fields
  const [variation, setVariation] = useState("");
  const [insert, setInsert] = useState("");
  const [parallel, setParallel] = useState("");
  const [serialNumber, setSerialNumber] = useState<string>("");
  const [serialTotal, setSerialTotal] = useState<string>("");

  const [isRookie, setIsRookie] = useState(false);
  const [isAutograph, setIsAutograph] = useState(false);
  const [isPatch, setIsPatch] = useState(false);

  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Vision Engine V2, Phase 5B correction: once createMyCard() succeeds for
  // this form submission, its id is retained here so a later retry (after a
  // media-sync failure) never creates a second card row. The four "pending"
  // flags track exactly which post-creation work this submission still
  // owes -- each is set once, at creation time, to whatever actually needs
  // doing, and only ever cleared by that specific piece of work succeeding
  // (or turning out to be moot, e.g. the image was removed before a
  // retry). A retry re-reads these instead of recomputing "what's needed"
  // from scratch, so a side that already succeeded is never re-uploaded
  // just because the opposite side failed. All five reset to their initial
  // values only once a full cycle succeeds and the form is actually reset
  // (see onSaveAndAddAnother) -- never on a mere retry.
  const [createdCardId, setCreatedCardId] = useState<string | null>(null);
  const [legacyFrontPending, setLegacyFrontPending] = useState(false);
  const [frontMediaPending, setFrontMediaPending] = useState(false);
  const [backMediaPending, setBackMediaPending] = useState(false);
  const [sharedImagePending, setSharedImagePending] = useState(false);
  // Vision Engine V2, Phase 6A: OCR persistence tracked the same way as
  // media -- independently per side, never blocking or masking the other
  // side. Unlike the media flags, an OCR failure never sets anyFailed in
  // runSaveCycle (OCR is best-effort; the card and its images are already
  // safely saved regardless), so it never blocks navigation/reset -- it's
  // simply left pending for a later opportunistic retry within the same
  // still-mounted session (e.g. a subsequent Save click after a media
  // failure), same as before this phase, when OCR never retried at all.
  const [frontOcrPending, setFrontOcrPending] = useState(false);
  const [backOcrPending, setBackOcrPending] = useState(false);

  // Vision Engine V2, Phase 4: two independent image slots. Only the front
  // slot feeds save/OCR/shared-image behavior (unchanged from before this
  // task) -- the back slot is UI-only client state for now, not persisted
  // anywhere yet.
  const frontImage = useCardImageSlot("front");
  const backImage = useCardImageSlot("back");

  // Mobile Add UX: the one shared consumer for any File captured by the
  // center mobile Add button's hidden input (AppShell.tsx) and stashed via
  // setPendingScanImage -- feeds it into the exact same handleImageFile
  // path the page's own uploader control uses, no separate image-
  // processing logic. Only reads (never opens) the picker itself, so it
  // cannot violate the user-gesture requirement handleMobileAddTap
  // preserves. takePendingScanImage() clears its slot on read, so calling
  // this with nothing pending -- a direct /cards/new(?mode=scan) visit, a
  // React Strict Mode double-invoke, or a stray event -- is always a safe
  // no-op; the File can never be processed twice. setEntryMode("form")
  // ensures a capture taken from the choice screen, or after the user
  // switched to manual entry, lands them on the form with the image
  // applied instead of leaving the crop result underneath an incompatible
  // mode -- the explicit Add tap is treated as an explicit request to scan.
  function consumePendingScanImage() {
    const file = takePendingScanImage();
    if (!file) return;
    setEntryMode("form");
    frontImage.handleImageFile(file);
  }

  // Covers arriving via navigation (Add tapped from elsewhere): runs once
  // at mount. If nothing is pending (direct visit), this is a no-op.
  useEffect(() => {
    consumePendingScanImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers tapping Add again while already mounted on /cards/new, where a
  // router.push to the same route wouldn't remount the page (see
  // AppShell's handleMobileAddFileSelected) -- the mount effect above
  // would never see the new File without this. The event carries no File
  // payload; pendingScanImage.ts remains the single source of truth, this
  // listener only knows to re-check it, via the same shared consumer.
  useEffect(() => {
    function onPendingScanImage() {
      consumePendingScanImage();
    }
    window.addEventListener(PENDING_SCAN_IMAGE_EVENT, onPendingScanImage);
    return () => window.removeEventListener(PENDING_SCAN_IMAGE_EVENT, onPendingScanImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScanCard() {
    setEntryMode("form");
    scanInputRef.current?.click();
  }

  // Vision Engine V2, Phase 6A: OCR runs independently per side, each once
  // per confirmed crop of that side's slot -- back now triggers its own OCR
  // too (front previously was the only side wired in). confirmCrop()
  // doesn't return the freshly-cropped imageUrl (and useCardImageSlot isn't
  // modified to add that), so a pending-flag + effect on imageUrl is used
  // instead of reading imageUrl right after awaiting confirmCrop(), which
  // would still see the stale pre-crop value from this closure. Each
  // effect also clears that side's cached OCR result the moment imageUrl
  // becomes null (removed) or right before a replacement crop is confirmed,
  // so replacing/removing one side never affects the other's OCR state.
  // Vision Engine V2, Phase 6A correction: "done" means a genuinely
  // completed OCR attempt (which may have found no text -- still a
  // success); "failed" means the request/response itself was invalid.
  // These are never conflated -- see runOcr's contract in src/lib/ocr.
  const [frontOcrStatus, setFrontOcrStatus] = useState<"idle" | "running" | "done" | "failed">(
    "idle",
  );
  const [frontOcrResult, setFrontOcrResult] = useState<CardOcrResult | null>(null);
  const [frontOcrError, setFrontOcrError] = useState("");
  const pendingFrontOcrRef = useRef(false);

  const [backOcrStatus, setBackOcrStatus] = useState<"idle" | "running" | "done" | "failed">(
    "idle",
  );
  const [backOcrResult, setBackOcrResult] = useState<CardOcrResult | null>(null);
  const [backOcrError, setBackOcrError] = useState("");
  const pendingBackOcrRef = useRef(false);

  // Vision Engine V3, Phase V3.1B (cleanup pass): visual-observation
  // analysis state, one independent set per side -- deliberately separate
  // from every OCR state field above so a vision failure can never touch
  // OCR state (or vice versa). This phase has no visual-observations UI, so
  // only what lifecycle correctness actually depends on is tracked as
  // state/refs: the current validated result (frontVisionResult, read by
  // save-time persistence and by a later UI phase), the image key that
  // result belongs to (frontVisionImageKeyRef -- stale-response guard,
  // checked again in resolveVisionResultForSave), the in-flight request
  // (frontVisionRequestRef -- so save can await it, bounded), and the
  // pending-analysis trigger (pendingFrontVisionRef -- fires at most once
  // per confirmed crop). A per-side status/error React state pair
  // (idle/analyzing/complete/failed + a display message) was deliberately
  // NOT added back: nothing reads either value yet (there is no UI for
  // them in this phase), so they would exist only to be unused -- lifecycle
  // correctness (triggering, dedup, staleness, save-time waiting,
  // persistence validation, front/back independence) does not depend on
  // either. A future UI phase can reintroduce them once something actually
  // renders them.
  const [frontVisionResult, setFrontVisionResult] = useState<CardVisionAnalysis | null>(null);
  const pendingFrontVisionRef = useRef(false);
  const frontVisionImageKeyRef = useRef<string | null>(null);
  const frontVisionRequestRef = useRef<Promise<CardVisionAnalysis> | null>(null);

  const [backVisionResult, setBackVisionResult] = useState<CardVisionAnalysis | null>(null);
  const pendingBackVisionRef = useRef(false);
  const backVisionImageKeyRef = useRef<string | null>(null);
  const backVisionRequestRef = useRef<Promise<CardVisionAnalysis> | null>(null);

  async function handleConfirmFrontCrop() {
    pendingFrontOcrRef.current = true;
    setFrontOcrResult(null);
    pendingFrontVisionRef.current = true;
    setFrontVisionResult(null);
    frontVisionImageKeyRef.current = null;
    frontVisionRequestRef.current = null;
    await frontImage.confirmCrop();
  }

  async function handleConfirmBackCrop() {
    pendingBackOcrRef.current = true;
    setBackOcrResult(null);
    pendingBackVisionRef.current = true;
    setBackVisionResult(null);
    backVisionImageKeyRef.current = null;
    backVisionRequestRef.current = null;
    await backImage.confirmCrop();
  }

  useEffect(() => {
    if (!frontImage.imageUrl) {
      setFrontOcrResult(null);
      setFrontOcrStatus("idle");
      setFrontOcrError("");
      return;
    }
    if (!pendingFrontOcrRef.current) return;
    pendingFrontOcrRef.current = false;

    let active = true;
    setFrontOcrStatus("running");

    (async () => {
      // A small minimum display time keeps "Reading front…" from flashing
      // for an imperceptible instant when the API responds very quickly.
      const minDisplay = new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const [result] = await Promise.all([runOcr(frontImage.imageUrl!, "front"), minDisplay]);
        if (!active) return;
        setFrontOcrResult(result);
        setFrontOcrStatus("done");
        // Back OCR never feeds catalog matching in this phase -- only front
        // does, unchanged from before this task. A successful-but-empty
        // result simply produces no useful query, which is fine.
        if (result.rawText) setCatalogQuery(buildCatalogQuery(toLegacyOcrResult(result)));
      } catch {
        if (!active) return;
        setFrontOcrResult(null);
        setFrontOcrStatus("failed");
      }
    })();

    return () => {
      active = false;
    };
  }, [frontImage.imageUrl]);

  useEffect(() => {
    if (!backImage.imageUrl) {
      setBackOcrResult(null);
      setBackOcrStatus("idle");
      setBackOcrError("");
      return;
    }
    if (!pendingBackOcrRef.current) return;
    pendingBackOcrRef.current = false;

    let active = true;
    setBackOcrStatus("running");

    (async () => {
      const minDisplay = new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const [result] = await Promise.all([runOcr(backImage.imageUrl!, "back"), minDisplay]);
        if (!active) return;
        setBackOcrResult(result);
        setBackOcrStatus("done");
      } catch {
        if (!active) return;
        setBackOcrResult(null);
        setBackOcrStatus("failed");
      }
    })();

    return () => {
      active = false;
    };
  }, [backImage.imageUrl]);

  // Vision Engine V3, Phase V3.1B: visual-observation analysis, independent
  // of OCR above -- same crop-confirmed trigger (pendingFrontVisionRef,
  // armed in handleConfirmFrontCrop) and the same "fire at most once per
  // confirmed crop" guard, but its own effect/state/ref set entirely, so a
  // vision failure can never clear OCR output, block candidate search, or
  // block save (candidate search below still depends only on mergedOcr,
  // built only from frontOcrResult/backOcrResult -- untouched by this
  // effect). Visual observations are not merged into mergedOcr in this
  // phase.
  //
  // Stale-response guard: this effect is keyed on frontImage.imageUrl
  // itself (a new crop/replace/retake/removal always changes that value),
  // so React runs this effect's cleanup (active = false) before the next
  // run starts -- an explicit, dependency-driven guard, not a reliance on
  // component unmounting. A slow response from an image that's since been
  // replaced always lands in a closure where active is already false.
  useEffect(() => {
    if (!frontImage.imageUrl) {
      setFrontVisionResult(null);
      frontVisionImageKeyRef.current = null;
      frontVisionRequestRef.current = null;
      return;
    }
    if (!pendingFrontVisionRef.current) return;
    pendingFrontVisionRef.current = false;

    let active = true;
    const imageKey = frontImage.imageUrl;

    const request = runVisionAnalysis(imageKey, "front");
    frontVisionRequestRef.current = request;

    request
      .then((result) => {
        if (!active) return;
        setFrontVisionResult(result);
        frontVisionImageKeyRef.current = imageKey;
      })
      .catch(() => {
        if (!active) return;
        // Covers every failure mode uniformly, including an anonymous
        // session (/api/vision's 401): the side is simply left without a
        // persistable result -- no retry loop, nothing that blocks
        // cropping, OCR, or manual entry, no unhandled rejection (this
        // .catch is the terminal handler for `request`), and no raw error
        // exposed anywhere. No user-facing message is produced until a
        // future UI phase.
        setFrontVisionResult(null);
        frontVisionImageKeyRef.current = null;
      });

    return () => {
      active = false;
    };
  }, [frontImage.imageUrl]);

  useEffect(() => {
    if (!backImage.imageUrl) {
      setBackVisionResult(null);
      backVisionImageKeyRef.current = null;
      backVisionRequestRef.current = null;
      return;
    }
    if (!pendingBackVisionRef.current) return;
    pendingBackVisionRef.current = false;

    let active = true;
    const imageKey = backImage.imageUrl;

    const request = runVisionAnalysis(imageKey, "back");
    backVisionRequestRef.current = request;

    request
      .then((result) => {
        if (!active) return;
        setBackVisionResult(result);
        backVisionImageKeyRef.current = imageKey;
      })
      .catch(() => {
        if (!active) return;
        setBackVisionResult(null);
        backVisionImageKeyRef.current = null;
      });

    return () => {
      active = false;
    };
  }, [backImage.imageUrl]);

  // Vision Engine V2, Phase 6B: pure, in-memory reconciliation of the two
  // independent side results -- never persisted (front/back card_media.
  // ocr_output are untouched), and not yet wired into catalog matching.
  // Catalog autofill below still uses the front-only OCR result directly
  // via toLegacyOcrResult, unchanged from before this task.
  const mergedOcr = useMemo(
    () => mergeCardOcrResults(frontOcrResult, backOcrResult),
    [frontOcrResult, backOcrResult],
  );

  // Vision Engine V3, Phase V3.2F: full fused evidence (OCR + Vision).
  // Vision Engine V3, Phase V3.4A: this is now the base displayEvidence is
  // built from below, which in turn is the single evidence object driving
  // candidate search, candidate confidence, AND variant ranking -- the
  // OCR-only restriction from V3.2D-V3.2F (a separate ocrOnlyFusedEvidence
  // value, passed only to candidateEngine/candidateConfidence) has been
  // retired: this phase's whole point is that reasoning becomes "live"
  // against the complete local evidence picture (OCR + Vision + manual
  // overrides), not OCR-only. See displayEvidence's own comment below for
  // what this means for search-cycle/re-fetch behavior.
  const fullFusedEvidence = useMemo(
    () =>
      buildFusedEvidence({
        frontOcr: frontOcrResult,
        backOcr: backOcrResult,
        mergedOcr,
        frontVision: frontVisionResult,
        backVision: backVisionResult,
      }),
    [frontOcrResult, backOcrResult, mergedOcr, frontVisionResult, backVisionResult],
  );

  // Vision Engine V3, Phase V3.3B: local-only manual Evidence Inspector
  // overrides -- no persistence, no save-payload changes, no API. Kept
  // entirely separate from every existing form-field state (playerName,
  // year, etc. below); selecting/removing an override never writes to any
  // of those.
  const [manualOverrides, setManualOverrides] = useState<ManualOverridesByField>({});

  // Vision Engine V3, Phase V3.5A2: durable persistence of manualOverrides
  // for /cards/new only -- mirrors the media/OCR pending-retry pattern
  // above (createdCardId + per-step "pending" flags), but recomputes its
  // "needs work" decision fresh on every runSaveCycle call instead of
  // deciding once at card-creation time. Overrides remain live/editable
  // (see displayEvidence) for as long as the user stays on this page,
  // including while a retry is pending after an unrelated step's failure,
  // so freezing the intended set at creation time the way media does would
  // silently drop a correction the user made after the first attempt.
  // manualOverridesPending only affects the Save button's retry label
  // (folded into hasPendingRetry below) -- it does not gate whether a
  // retry re-attempts persistence; lastPersistedManualOverridesRef does
  // that (skips the network call entirely when the snapshot object is
  // reference-identical to the last snapshot that persisted successfully,
  // relying on manualOverrides only ever being replaced wholesale via
  // setManualOverrides, never mutated in place).
  const [manualOverridesPending, setManualOverridesPending] = useState(false);
  const [manualOverridesError, setManualOverridesError] = useState("");
  const lastPersistedManualOverridesRef = useRef<ManualOverridesByField | null>(null);

  // Vision Engine V3, Phase V3.4A: the single evidence object driving
  // candidate search, candidate confidence, variant ranking, AND the
  // Inspector -- reusing applyManualOverrides() (unchanged, not duplicated)
  // rather than re-fusing here. Memoized on [fullFusedEvidence,
  // manualOverrides] only, so it recomputes exactly once per genuine
  // change to either, never redundantly.
  //
  // Because displayEvidence's identity now depends on fullFusedEvidence
  // (which itself depends on frontVisionResult/backVisionResult), the
  // reasoning effects below correctly re-run not only when an override
  // changes but also when Vision analysis completes -- this is the
  // intended "live, local-evidence" behavior this phase introduces, not an
  // accident. It does NOT re-trigger OCR or Vision network calls
  // themselves (those effects depend only on frontImage.imageUrl/
  // backImage.imageUrl, untouched by this phase), and it does NOT change
  // searchCycleKey (still built solely from mergedOcr, below) or reset the
  // manual-candidate-interaction/auto-select guards that key gates.
  const displayEvidence = useMemo(
    () => applyManualOverrides(fullFusedEvidence, manualOverrides),
    [fullFusedEvidence, manualOverrides],
  );

  function handleEvidenceOverride<K extends EvidenceFieldName>(
    field: K,
    value: EvidenceValueForField<K>,
    explanation: string,
  ) {
    setManualOverrides((prev) => ({
      ...prev,
      [field]: { value, createdAt: new Date().toISOString(), explanation },
    }));
  }

  // Add Card scan UX simplification, Phase F: no longer called from this
  // component's JSX now that the full override-editor UI (EvidenceInspector/
  // EvidenceFieldCard's per-field "Remove Override" button) is no longer
  // rendered -- the new minimal identity-conflict prompt only ever adds an
  // override (applyIdentityConflictResolution above), it never removes one.
  // Left in place, unchanged and still fully functional against
  // manualOverrides/displayEvidence exactly as before, as internal capability
  // preserved for a future phase's UI (matching this file's existing
  // precedent for candidateAutoSelected in Phase C).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleRemoveEvidenceOverride(field: EvidenceFieldName) {
    setManualOverrides((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  // Add Card scan UX simplification, Phase F: derives the ONLY evidence
  // conflicts ever shown to the collector -- identity-relevant fields
  // (IDENTITY_CONFLICT_FIELDS above) that are genuinely in FusedEvidence's
  // own "conflicted" state, each reduced to its distinct disputed values.
  // Purely a read of the already-computed displayEvidence -- no new fusion,
  // no new conflict detection, nothing recomputed that wasn't already
  // computed before this phase. Rendering (see the JSX below) additionally
  // gates this on !selectedCandidate && candidateResults.length === 0, so
  // this list can be non-empty (e.g. a dominant-color-only conflict is
  // never in it, but a genuine year conflict on an already-identified card
  // can be) without ever actually being shown -- Case A/B/C in this phase's
  // spec take priority over any identity conflict that happens to exist.
  const identityFieldConflicts = useMemo(
    () =>
      IDENTITY_CONFLICT_FIELDS.flatMap(({ field, label }) => {
        const evidenceField = displayEvidence[field];
        if (evidenceField.state !== "conflicted") return [];
        const values = new Set<string>();
        for (const conflict of evidenceField.conflicts) {
          for (const observation of conflict.observations) {
            if (observation.value) values.add(observation.value);
          }
        }
        return values.size > 0 ? [{ field, label, values: [...values] }] : [];
      }),
    [displayEvidence],
  );

  // Applies the collector's answer through the exact same write-back path
  // as the (now-internal) full override editor -- handleEvidenceOverride ->
  // manualOverrides -> displayEvidence -> candidate search/confidence/
  // variant ranking. A switch over literal field names (rather than passing
  // the IdentityEvidenceFieldName-typed `field` straight through) so each
  // call site keeps handleEvidenceOverride's own generic fully and
  // unambiguously inferred, with no type assertion required.
  function applyIdentityConflictResolution(field: IdentityEvidenceFieldName, value: string) {
    const explanation = "Manually resolved from conflicting evidence.";
    switch (field) {
      case "playerName":
        handleEvidenceOverride("playerName", value, explanation);
        return;
      case "cardNumber":
        handleEvidenceOverride("cardNumber", value, explanation);
        return;
      case "setName":
        handleEvidenceOverride("setName", value, explanation);
        return;
      case "year":
        handleEvidenceOverride("year", value, explanation);
        return;
      case "cardName":
        handleEvidenceOverride("cardName", value, explanation);
        return;
      case "parallelText":
        handleEvidenceOverride("parallelText", value, explanation);
        return;
      case "brand":
        handleEvidenceOverride("brand", value, explanation);
        return;
    }
  }

  // Vision Engine V2, Phase 7C: a stable identity for the current
  // candidate-search cycle, built only from the merged OCR fields that
  // actually drive candidate lookup/scoring (see candidateEngine.ts's
  // WEIGHTS / candidateConfidence.ts's FIELD_DEFINITIONS). Deliberately a
  // plain string, not mergedOcr itself -- mergedOcr's object identity can
  // change (e.g. conflictCount/createdAt) without any of these values
  // actually changing, and this key must NOT change in that case (used
  // below to reset the manual-interaction guard only on a genuinely new
  // search, never merely because confidence recalculated or the page
  // rerendered).
  const searchCycleKey = useMemo(() => buildSearchCycleKey(mergedOcr), [mergedOcr]);

  // Vision Engine V2, Phase 7A: catalog candidate engine -- a ranked,
  // scored search result only. findCatalogCandidates() hits the database
  // (searches, never mutates), so it can't be a plain synchronous useMemo;
  // this is the async equivalent (effect + state, recomputed only when the
  // merged OCR result actually changes). Nothing here selects a candidate
  // or changes catalogQuery/saved data on its own -- see Phase 7C's
  // auto-preselect effect and the read-only summary display below.
  // Vision Engine V3, Phase V3.2D: now called with fused evidence instead
  // of mergedOcr directly -- candidateEngine.ts no longer accepts
  // MergedCardOcrResult at all. Vision Engine V3, Phase V3.4A: that
  // evidence is now displayEvidence (see below), not an OCR-only value.
  const [candidateResults, setCandidateResults] = useState<CatalogCandidate[]>([]);
  // Vision Engine V2, Phase 7C: which search-cycle key candidateResults
  // actually corresponds to, set only once a fetch for that cycle has
  // resolved. Needed so the auto-preselect effect never acts on a stale
  // candidateResults array left over from the previous cycle while a new
  // search is still in flight (candidateResults is deliberately not
  // cleared at the start of a new search, so its content alone can't tell
  // "still loading" apart from "loaded, found nothing").
  const [resolvedCandidateCycleKey, setResolvedCandidateCycleKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!mergedOcr.frontAvailable && !mergedOcr.backAvailable) {
      setCandidateResults([]);
      setResolvedCandidateCycleKey(searchCycleKey);
      return;
    }

    findCatalogCandidates(displayEvidence)
      .then((results) => {
        if (!active) return;
        setCandidateResults(results);
        setResolvedCandidateCycleKey(searchCycleKey);
      })
      .catch(() => {
        if (!active) return;
        setCandidateResults([]);
        setResolvedCandidateCycleKey(searchCycleKey);
      });

    return () => {
      active = false;
    };
    // Vision Engine V3, Phase V3.4A: depends on displayEvidence (not just
    // mergedOcr) so a manual override -- or Vision completing -- reruns
    // this search; mergedOcr stays a dependency too since the early-return
    // gate above reads it directly. searchCycleKey is NOT used to gate or
    // trigger this effect's re-fetch (it never was) -- it only identifies
    // which cycle a resolved result belongs to, and continues to change
    // only when mergedOcr's candidate-driving fields change (see
    // buildSearchCycleKey), independent of displayEvidence.
  }, [mergedOcr, displayEvidence, searchCycleKey]);

  // Vision Engine V2, Phase 7B: candidate confidence/explainability. Pure
  // and synchronous (unlike candidate search, it never touches the
  // database -- it only re-examines displayEvidence + the already-fetched
  // candidateResults), so a plain useMemo is enough.
  // Vision Engine V3, Phase V3.4A: now reads displayEvidence -- the same
  // single evidence object candidate search and variant ranking use --
  // instead of a separate OCR-only value.
  // Add Card scan UX simplification, Phase I: no longer read by the
  // automatic-application effect below (which now applies candidateResults[0]
  // unconditionally -- see shouldAutoApplyTopCandidate's own comment) or by
  // any other current UI, since Phase C already removed this normal-path
  // rendering. Left fully computed and unchanged, exactly per this task's
  // Step 14 requirement -- assessCandidateConfidence/MatchQuality/
  // shouldAutoSelectCandidate's underlying architecture is preserved for
  // future use (a stricter future auto-behavior, telemetry, deciding when
  // more evidence is needed, community visual-reference matching), even
  // though nothing in this page currently reads the result.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const confidenceAssessments = useMemo(
    () => assessCandidateConfidence(displayEvidence, candidateResults),
    [displayEvidence, candidateResults],
  );

  // Vision Engine V2, Phase 7C: safe candidate preselection. selectedCandidate
  // is the one, shared source of truth for "is a candidate selected" --
  // used both by manual selection (selectCandidateManually/
  // clearSelectedCandidate below) and by automatic preselection, so there
  // is exactly one field-population code path for both
  // (applyCandidateSelection). candidateAutoSelected never gates any
  // behavior -- Phase C removed the one place that read it (a "selected
  // automatically" notice showing the confidence percentage, which the
  // normal-path summary no longer surfaces); the setter calls below are
  // left exactly as they were, so this stays available internally should
  // a later phase want it again.
  const [selectedCandidate, setSelectedCandidate] = useState<CatalogCandidate | null>(null);
  // Read intentionally unused for now (see comment above); setter is still used.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [candidateAutoSelected, setCandidateAutoSelected] = useState(false);
  // Add Card scan UX simplification, Phase C: local-only disclosure state
  // for the candidate-alternatives chooser -- never read by save/identity
  // logic (Phase A/B), never gates candidate retrieval/ranking/confidence.
  // Default false: a normal successful identification shows the concise
  // summary + "Change card" control, not the full candidate list. Reset at
  // the same search-cycle boundary as the other candidate-interaction refs
  // below, so a stale "open" chooser from a previous identification can't
  // linger once new scan evidence starts a genuinely new cycle.
  const [showCandidateAlternatives, setShowCandidateAlternatives] = useState(false);

  // Tracks whether the user has manually selected, switched, or
  // cleared/rejected a candidate during the CURRENT search cycle -- refs,
  // not state, since flipping them must never itself trigger a render, and
  // they must read as up-to-date inside the same effect pass that resets
  // them. Reset only when searchCycleKey actually changes (see the effect
  // below) -- never on an incidental rerender or a confidence recompute.
  const hasManualCandidateInteractionRef = useRef(false);
  // Belt-and-suspenders guard against auto-selecting more than once for the
  // same cycle even across back-to-back effect invocations (e.g. React
  // Strict Mode's dev-only double-invoke) that might run before the
  // selectedCandidate state update from the first invocation has
  // committed. The primary guard is still `selectedCandidate === null`.
  const autoSelectedCandidateCycleKeyRef = useRef<string | null>(null);
  const lastSearchCycleKeyRef = useRef(searchCycleKey);

  useEffect(() => {
    if (lastSearchCycleKeyRef.current === searchCycleKey) return;
    lastSearchCycleKeyRef.current = searchCycleKey;
    hasManualCandidateInteractionRef.current = false;
    autoSelectedCandidateCycleKeyRef.current = null;
    // Phase C: a genuinely new search cycle (retaken/re-cropped image, new
    // OCR evidence, a fresh scan) makes whatever the alternatives chooser
    // was open/closed for no longer relevant -- collapse it so it can't
    // stay open over an unrelated new set of candidates.
    setShowCandidateAlternatives(false);
    // Add Card scan UX simplification, Phase I lifecycle fix: a working
    // selection (auto-applied OR manually chosen) belongs to the search
    // cycle it was resolved against, never to a LATER one -- searchCycleKey
    // only changes when mergedOcr's identity-driving fields actually change
    // (buildSearchCycleKey), i.e. genuinely new scan evidence (a retake/
    // re-crop), so this is the same boundary hasManualCandidateInteractionRef
    // is already reset at above, applied symmetrically to selectedCandidate.
    // Without this, Cycle A's selectedCandidate (auto or manual) would keep
    // `hasSelectedCandidate: true` permanently true in
    // shouldAutoApplyTopCandidate's gate, silently preventing EVERY future
    // cycle's own top candidate from ever auto-applying again -- clearing it
    // here, not by weakening that gate, is the smallest correct fix.
    // candidateAutoSelected is reset alongside it for the same reason
    // (it's scoped to "was the CURRENT selection auto-applied", and there is
    // no current selection once a new cycle begins). This never fires
    // merely because candidateResults/confidence recomputed for the SAME
    // cycle (searchCycleKey is stable across those) -- only a genuine new
    // cycle reaches this branch at all (see the guard above).
    setSelectedCandidate(null);
    setCandidateAutoSelected(false);
  }, [searchCycleKey]);

  // Shared selection/field-population code path -- the ONE place that
  // writes candidate fields onto the form, used identically by manual
  // selection and by automatic preselection below.
  //
  // Identity-ownership fix (Phase B): every field CatalogCandidate actually
  // carries trustworthy canonical data for (playerName/year/setName/
  // cardNumber/parallel/checklist-section/team) is now unconditionally
  // recalculated from the given candidate, INCLUDING clearing it to empty
  // when this candidate has no value -- e.g. Candidate A's parallel
  // ("Silver") must not keep displaying once Candidate B (parallel: null)
  // is selected. Previously only playerName/cardNumber did this
  // unconditionally; year/setName/parallel used `if (candidate.X)`, which
  // left a stale prior value in place whenever the new candidate happened
  // to lack that field -- a real, reproducible bug, not a hypothetical one.
  //
  // Canonical per-card Team architecture: candidate.teamName is sourced
  // exclusively from this exact card's own card_players.team_id ->
  // teams.name relationship (see deriveCardTeamName in cards.ts) --
  // NEVER players.team_id, and unconditional here for the same
  // stale-value reason as every other field above: Candidate A's team
  // must not survive a switch to Candidate B, whether B has a different
  // team or none at all (null -> ""). A null teamName already correctly
  // covers both "no card_players row has a resolved team" (including the
  // Panini "Multiverse Jerseys" same-player/multiple-team case, left
  // unresolved on purpose) and "this card's players belong to genuinely
  // different teams" (e.g. a "Select Pairings" dual-player card) -- in
  // both cases the safe, non-guessing answer is an empty Team field, not
  // a fallback to any other data source.
  //
  // Fields CatalogCandidate does NOT carry any signal for -- manufacturer/
  // brand (no such form field exists at all), rookie -- are deliberately
  // left untouched here: a candidate switch has no canonical opinion on
  // them, so touching them would be inventing data, not applying canonical
  // identity. See src/lib/catalog/candidateEngine.ts's CatalogCandidate
  // type for the exact fields available.
  //
  // isAutograph/isPatch ARE reset here even though the candidate itself
  // carries no autograph/memorabilia signal: those two fields are only ever
  // populated by a VARIANT pick (the manual "Parallel / Variant" search box,
  // gated on selectedCard), which is scoped to a specific exact card --
  // Variant A's autograph/memorabilia flags must not silently remain
  // attached once a *different* exact card (Candidate B) becomes active.
  // Resetting them to a clean baseline on every exact-identity change (here
  // and in the manual Card-pick handler below) is the smallest correctness
  // fix that doesn't require per-field manual-edit dirty tracking (out of
  // scope for this phase) -- the tradeoff is that a checkbox the user
  // ticked by hand before a candidate/auto-select landed does not survive
  // it either, consistent with this phase's chosen "selecting a different
  // exact catalog card is itself an explicit instruction to use that
  // card's identity" rule.
  function applyCandidateSelection(candidate: CatalogCandidate) {
    setPlayerName(candidate.playerName ?? "");
    setYear(candidate.year ?? "");
    setSetName(candidate.setName ?? "");
    setCardNumber(candidate.cardNumber);
    setParallel(candidate.parallel ?? "");
    setInsert(
      candidate.checklistSectionCategory !== "base" ? candidate.checklistSectionName ?? "" : "",
    );
    setTeam(candidate.teamName ?? "");
    setIsAutograph(false);
    setIsPatch(false);
    setSelectedCandidate(candidate);
  }

  function selectCandidateManually(candidate: CatalogCandidate) {
    hasManualCandidateInteractionRef.current = true;
    setCandidateAutoSelected(false);
    applyCandidateSelection(candidate);
  }

  function clearSelectedCandidate() {
    hasManualCandidateInteractionRef.current = true;
    setCandidateAutoSelected(false);
    setSelectedCandidate(null);
  }

  // Add Card scan UX simplification, Phase D: the ONE place that applies a
  // chosen variant's canonical parallel/autograph/memorabilia identity onto
  // the form -- shared by the existing manual "Parallel / Variant"
  // search-box selection below and the new candidate-flow variant
  // refinement UI further down, so the exact same three fields are set the
  // exact same way regardless of which variant shape (CardVariantSummary
  // from the manual lookup, or VariantCandidate from the candidate-aware
  // ranking) triggered it -- both already carry these same three fields
  // with the same types, so no adapter/union type is needed. Deliberately
  // narrow: only the fields that already flow into buildCard()/save.
  function applyVariantSelection(variant: {
    parallelName: string | null;
    hasAutograph: boolean;
    hasMemorabilia: boolean;
  }) {
    setParallel(variant.parallelName ?? "");
    setIsAutograph(variant.hasAutograph);
    setIsPatch(variant.hasMemorabilia);
  }

  // Vision Engine V2, Phase 8A: variant-aware candidate search. Read-only,
  // additive on top of the existing card-candidate pipeline above -- never
  // reorders card candidates, never writes a variant ID into any save/
  // persistence path. Variants are only ever fetched for ONE card at a
  // time (the selected candidate, or the top candidate when nothing is
  // selected), never for every pooled search candidate.
  //
  // Add Card scan UX simplification, Phase D: this ranked list is still
  // computed exactly as before (including its "top candidate when nothing
  // is selected" fallback, left untouched so no internal data/caching
  // timing changes) -- what changed is presentation only, see the JSX
  // below. selectedVariantCandidate is NEW: unlike variantResults (a mere
  // ranking, never a selection -- see this section's own long-standing
  // comment above), this is set ONLY by an explicit user pick in the new
  // variant-refinement disclosure, so "ranked first" is never confused
  // with "selected" (ranked-but-unpicked variants are never treated as
  // resolved). Reset alongside variantResults whenever the active exact
  // card changes (see the effect below), so Variant A can never remain
  // attached once Card B becomes active.
  const activeCandidateForVariants = selectedCandidate ?? candidateResults[0] ?? null;

  const [variantResults, setVariantResults] = useState<VariantCandidate[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState(false);
  const [selectedVariantCandidate, setSelectedVariantCandidate] = useState<VariantCandidate | null>(null);
  const [showVariantRefinement, setShowVariantRefinement] = useState(false);

  // Small in-memory, page-level cache of the RAW (unranked) variant list
  // per card ID -- a card's own catalog variants don't change while this
  // page is open, so once fetched for a given cardId there's no need to
  // re-query just because displayEvidence changed (ranking against the
  // latest evidence is a cheap, pure, synchronous recompute via
  // rankCardVariants, done on every effect run regardless of cache hits).
  // A failed fetch is evicted from the cache so a later retry is possible.
  const variantFetchCacheRef = useRef<Map<number, Promise<CardVariantSummary[]>>>(new Map());

  function fetchVariantsForCardCached(cardId: number): Promise<CardVariantSummary[]> {
    const cache = variantFetchCacheRef.current;
    const existing = cache.get(cardId);
    if (existing) return existing;
    const promise = listCardVariantsForCard(cardId);
    cache.set(cardId, promise);
    promise.catch(() => cache.delete(cardId));
    return promise;
  }

  const activeVariantCardId = activeCandidateForVariants?.cardId ?? null;
  // Phase D: distinguishes "the active exact card itself changed" from
  // "the same card's variants are just being re-ranked against fresh
  // evidence" (this effect's other dependency, displayEvidence, changes
  // far more often -- e.g. every time Vision completes -- and must NOT
  // clear an explicit variant selection each time that happens).
  const prevActiveVariantCardIdRef = useRef(activeVariantCardId);

  useEffect(() => {
    let active = true;

    if (prevActiveVariantCardIdRef.current !== activeVariantCardId) {
      prevActiveVariantCardIdRef.current = activeVariantCardId;
      // Phase D: a genuinely different exact card is now active -- an
      // explicitly selected variant, and an open refinement disclosure,
      // both belonged to the PREVIOUS card and must never carry over onto
      // this one (Card A's Variant A must not remain attached to Card B).
      setSelectedVariantCandidate(null);
      setShowVariantRefinement(false);
    }

    if (activeVariantCardId === null) {
      setVariantResults([]);
      setVariantsError(false);
      setVariantsLoading(false);
      return;
    }

    // Clear immediately, before the fetch resolves, so switching candidates
    // never briefly shows the PREVIOUS candidate's variants while the new
    // request is in flight.
    setVariantResults([]);
    setVariantsError(false);
    setVariantsLoading(true);

    fetchVariantsForCardCached(activeVariantCardId)
      .then((variants) => {
        if (!active) return;
        setVariantResults(rankCardVariants(variants, displayEvidence));
        setVariantsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setVariantResults([]);
        setVariantsError(true);
        setVariantsLoading(false);
      });

    return () => {
      active = false;
    };
    // Vision Engine V3, Phase V3.4A: reranks against displayEvidence
    // (was fullFusedEvidence) -- a manual override now immediately
    // reranks variants for the currently-displayed card, in addition to
    // Vision arriving, exactly as before.
  }, [activeVariantCardId, displayEvidence]);

  const { fingerprint, sharedImage, reportInfo } = useSharedImageLookup({
    year,
    setName,
    cardNumber,
    playerName,
    team,
    insert,
    variation,
    parallel,
    serialTotal,
  });

  useEffect(() => {
    if (isWishlist) {
      setStatus("WANT");
      return;
    }
    if (isForSaleIntent) {
      setStatus("FOR_SALE");
    }
  }, [isWishlist, isForSaleIntent]);

  const isWishlistCard = isWishlist || status === "WANT";

  // Add Card scan UX simplification, Phase I: automatic application of the
  // TOP-RANKED candidate -- ONLY when every one of these holds:
  //  - not a wishlist card (candidate search/fields aren't shown there)
  //  - at least one candidate exists for this cycle (candidateResults[0])
  //  - candidateResults has finished loading FOR THIS cycle
  //    (resolvedCandidateCycleKey === searchCycleKey guards against acting
  //    on a stale array while a new search is still in flight)
  //  - no candidate is already selected (manual or auto)
  //  - the user hasn't manually selected/switched/cleared a candidate
  //    during this search cycle
  //  - this exact cycle hasn't already been auto-applied (rerender guard)
  // Deliberately NOT gated on confidenceAssessments/recommendation/
  // safe_to_preselect anymore -- see shouldAutoApplyTopCandidate's own
  // comment above for why. This never creates a catalog row, never saves,
  // never mutates persistence -- it only calls the same
  // applyCandidateSelection() a manual pick uses, on candidateResults[0]
  // (the engine's own top-ranked result, untouched by this phase).
  useEffect(() => {
    const eligible = shouldAutoApplyTopCandidate({
      isWishlistCard,
      hasSelectedCandidate: selectedCandidate !== null,
      hasManualInteraction: hasManualCandidateInteractionRef.current,
      alreadyAutoAppliedThisCycle: autoSelectedCandidateCycleKeyRef.current === searchCycleKey,
      candidatesResolvedForCurrentCycle: resolvedCandidateCycleKey === searchCycleKey,
      hasCandidates: candidateResults.length > 0,
    });
    if (!eligible) return;

    autoSelectedCandidateCycleKeyRef.current = searchCycleKey;
    applyCandidateSelection(candidateResults[0]);
    setCandidateAutoSelected(true);
  }, [isWishlistCard, selectedCandidate, resolvedCandidateCycleKey, searchCycleKey, candidateResults]);

  // frontImage/backImage are fresh objects returned by useCardImageSlot on
  // every render, so depending on them directly would rerun this effect on
  // every render (not just when isWishlistCard changes). Their individual
  // setter functions are ordinary useState setters, though, which React
  // guarantees keep a stable identity across renders of this component --
  // destructuring just the setters used here lets the dependency array be
  // exhaustive without changing when the effect actually fires.
  const { setImageUrl: setFrontImageUrl, setImageOwnerConfirm: setFrontImageOwnerConfirm, setImageShare: setFrontImageShare, setCardPhotoConfirm: setFrontCardPhotoConfirm } = frontImage;
  const { setImageUrl: setBackImageUrl, setImageOwnerConfirm: setBackImageOwnerConfirm, setImageShare: setBackImageShare, setCardPhotoConfirm: setBackCardPhotoConfirm } = backImage;

  useEffect(() => {
    if (!isWishlistCard) return;
    setLocation("");
    setPurchasePrice("");
    setPurchaseDate("");
    setFrontImageUrl(null);
    setFrontImageOwnerConfirm(false);
    setFrontImageShare(false);
    setFrontCardPhotoConfirm(false);
    setBackImageUrl(null);
    setBackImageOwnerConfirm(false);
    setBackImageShare(false);
    setBackCardPhotoConfirm(false);
  }, [
    isWishlistCard,
    setFrontImageUrl,
    setFrontImageOwnerConfirm,
    setFrontImageShare,
    setFrontCardPhotoConfirm,
    setBackImageUrl,
    setBackImageOwnerConfirm,
    setBackImageShare,
    setBackCardPhotoConfirm,
  ]);

  // Vision Engine V2, Phase 6A correction: true once a card has been
  // created for this submission but some media or OCR work is still
  // pending from a prior failed attempt -- used purely to relabel the save
  // buttons so a retry doesn't read as "create another card." OCR pending
  // now counts here too, since an actual OCR failure blocks
  // navigation/reset the same way a media failure does.
  const hasPendingRetry =
    !!createdCardId &&
    (legacyFrontPending ||
      frontMediaPending ||
      backMediaPending ||
      frontOcrPending ||
      backOcrPending ||
      manualOverridesPending);

  // Save eligibility remains gated on the FRONT slot only -- the back slot
  // is not required and does not block saving in this phase.
  const canSave = useMemo(() => {
    const baseOk = Boolean(playerName.trim() && year.trim() && setName.trim());
    if (!frontImage.imageUrl) return baseOk;
    if (frontImage.imageCheckStatus === "checking") return false;
    return baseOk && frontImage.cardPhotoConfirm;
  }, [
    playerName,
    year,
    setName,
    frontImage.imageUrl,
    frontImage.cardPhotoConfirm,
    frontImage.imageCheckStatus,
  ]);

  const {
    checklistQuery,
    setChecklistQuery,
    showChecklistResults,
    setShowChecklistResults,
    checklistSection,
    setChecklistSection,
    activeChecklist,
    checklistResults,
    checklistLoading,
    checklistGroups,
  } = useChecklistLookup({ setEntries, year, setName });

  function buildCard(): MyCardInput | null {
    if (!canSave) return null;

    const derivedSerialTotal =
      serialTotal.trim() ||
      (parallel.match(/\/\s*(\d+)\b/) ? parallel.match(/\/\s*(\d+)\b/)?.[1] ?? "" : "");

    const card: MyCardInput = {
      playerName: playerName.trim(),
      year: year.trim(),
      setName: setName.trim(),
      cardNumber: cardNumber.trim() || undefined,
      team: team.trim() || undefined,

      // Save-identity precedence fix (Add Card scan UX audit, Phase A): a
      // scan-selected candidate (selectedCandidate, from the OCR/candidate-
      // engine Top Candidate flow -- auto- or manually accepted) already
      // names an EXACT cards.id, and per the audit's finding, saving used to
      // ignore it entirely, falling through to legacy (set_id, card_number)
      // text resolution even when the on-screen Top Candidate named a
      // specific, already-resolved checklist-section card. selectedCandidate
      // now takes priority whenever it's set, since it represents the most
      // recently, most-precisely confirmed identity; selectedCard (the
      // separate manual Set/Section/Card lookup's own state, or the
      // ?catalogCardId= URL bootstrap) is the fallback -- both preserved
      // exactly as before for every caller that never touches a scan
      // candidate. undefined when neither exists, in which case
      // resolveCatalogIds() falls through to its existing free-text
      // resolution, exactly as before this field existed. Selecting a
      // manual catalog card explicitly (see its onMouseDown handler below)
      // clears selectedCandidate so a stale scan candidate can never
      // outrank a more recent, explicit manual choice.
      catalogCardId: selectedCandidate?.cardId ?? selectedCard?.id,

      // Catalog v2: only set when a section has been picked (see
      // useChecklistSectionLookup) -- undefined here means
      // resolveCatalogIds() falls through to the exact existing V1 flow.
      checklistSectionId: selectedSection?.id,

      location: isWishlistCard ? undefined : location.trim() || undefined,

      gradingStatus,
      grader: gradingStatus === "GRADED" ? (grader.trim() || undefined) : undefined,
      grade: gradingStatus === "GRADED" ? (grade.trim() || undefined) : undefined,

      status: isWishlistCard ? "WANT" : status,

      purchasePrice: isWishlistCard ? undefined : toNum(purchasePrice),
      estimatedValue: isWishlistCard ? undefined : toNum(marketValue),
      purchaseDate: isWishlistCard ? undefined : purchaseDate || undefined,

      variation: variation.trim() || undefined,
      insert: insert.trim() || undefined,
      parallel: parallel.trim() || undefined,
      serialNumber: isWishlistCard ? undefined : toNum(serialNumber),
      serialTotal: toNum(derivedSerialTotal),

      isRookie: isRookie || undefined,
      isAutograph: isAutograph || undefined,
      isPatch: isPatch || undefined,

      notes: notes.trim() || undefined,

      imageShared: isWishlistCard ? undefined : frontImage.imageShare || undefined,
      imageType: isWishlistCard ? undefined : frontImage.imageType,
    };

    return card;
  }

  // Vision Engine V2, Phase 5B correction: creates the card exactly once
  // per form submission, then runs every post-creation step (legacy front
  // save, private front/back media upload+persist, front-only shared-image
  // upload) gated by its own "pending" flag. On the very first call for a
  // submission (createdCardId is still null), every flag is initialized
  // from what's actually present; createMyCard() only ever runs in that
  // branch. On a retry (createdCardId already set), createMyCard() is never
  // called again -- only whatever is still marked pending from the
  // previous attempt is retried, so a side that already succeeded is never
  // re-uploaded just because the opposite side (or the legacy save) failed.
  // Returns the card id and whether every pending step succeeded; the card
  // row itself is never rolled back or discarded on a media failure.
  async function runSaveCycle(): Promise<{ cardId: string; succeeded: boolean } | null> {
    let cardId = createdCardId;
    let profileId: string;
    let needsLegacyFront: boolean;
    let needsFrontMedia: boolean;
    let needsBackMedia: boolean;
    let needsSharedImage: boolean;
    let needsFrontOcr: boolean;
    let needsBackOcr: boolean;

    if (!cardId) {
      const input = buildCard();
      if (!input) return null;
      profileId = await requireProfileId();
      const card = await createMyCard(profileId, input);
      cardId = card.id;
      setCreatedCardId(cardId);

      needsLegacyFront = !isWishlistCard && !!frontImage.imageUrl;
      needsFrontMedia = !isWishlistCard && !!frontImage.imageUrl;
      needsBackMedia = !isWishlistCard && !!backImage.imageUrl;
      needsSharedImage = true;
      needsFrontOcr = !isWishlistCard && !!frontImage.imageUrl;
      needsBackOcr = !isWishlistCard && !!backImage.imageUrl;

      setLegacyFrontPending(needsLegacyFront);
      setFrontMediaPending(needsFrontMedia);
      setBackMediaPending(needsBackMedia);
      setSharedImagePending(needsSharedImage);
      setFrontOcrPending(needsFrontOcr);
      setBackOcrPending(needsBackOcr);
    } else {
      profileId = await requireProfileId();
      needsLegacyFront = legacyFrontPending;
      needsFrontMedia = frontMediaPending;
      needsBackMedia = backMediaPending;
      needsSharedImage = sharedImagePending;
      needsFrontOcr = frontOcrPending;
      needsBackOcr = backOcrPending;
    }

    let anyFailed = false;

    // Vision Engine V3, Phase V3.5A2: manual evidence override persistence.
    // Runs immediately after cardId is resolved and before every other
    // post-creation step (legacy/media/OCR/vision/shared-image), per this
    // phase's required sequence. Unlike those steps, this is NOT
    // best-effort: overrides are irreproducible human input, so a failure
    // here sets anyFailed and produces a dedicated retry message, the same
    // way a media/OCR failure does.
    //
    // manualOverridesSnapshot is an immutable local snapshot of the current
    // manualOverrides state, taken synchronously here (before any awaits in
    // this cycle) -- manualOverrides itself is never mutated in place (see
    // setManualOverrides above), so this reference can never change out
    // from under the persistence call that follows, even though the async
    // call yields control back to React in between.
    const manualOverridesSnapshot = manualOverrides;
    const needsManualOverrides = Object.keys(manualOverridesSnapshot).length > 0;
    const manualOverridesAlreadyPersisted =
      lastPersistedManualOverridesRef.current === manualOverridesSnapshot;

    if (needsManualOverrides && !manualOverridesAlreadyPersisted) {
      try {
        await replaceManualEvidenceOverrides(cardId, manualOverridesSnapshot);
        lastPersistedManualOverridesRef.current = manualOverridesSnapshot;
        setManualOverridesPending(false);
        setManualOverridesError("");
      } catch {
        anyFailed = true;
        setManualOverridesPending(true);
        setManualOverridesError(
          "Card saved, but your evidence corrections could not be stored. Press Save again to retry.",
        );
      }
    } else {
      setManualOverridesPending(false);
    }

    // Legacy localStorage save -- tracked independently of private media,
    // per side, so a legacy failure never blocks (or is masked by) the
    // private front/back media outcome below.
    if (needsLegacyFront) {
      if (frontImage.imageUrl) {
        try {
          saveImageForCard(String(cardId), frontImage.imageUrl);
          await saveThumbnailForCard(String(cardId), frontImage.imageUrl);
          setLegacyFrontPending(false);
        } catch {
          anyFailed = true;
        }
      } else {
        // Removed before a retry -- nothing left to save.
        setLegacyFrontPending(false);
      }
    }

    // frontMediaRow/backMediaRow are populated either by a fresh
    // upload+upsert this cycle, or (below) by fetching the row that a
    // *previous* cycle already created -- so OCR persistence can find its
    // target row without ever re-uploading a side that already succeeded.
    let frontMediaRow: Awaited<ReturnType<typeof upsertCardMediaBySide>> | null = null;
    let backMediaRow: Awaited<ReturnType<typeof upsertCardMediaBySide>> | null = null;

    if (needsFrontMedia) {
      if (frontImage.imageUrl) {
        try {
          const { path } = await uploadCardMediaImage({
            profileId,
            userCardId: cardId,
            side: "front",
            dataUrl: frontImage.imageUrl,
          });
          frontMediaRow = await upsertCardMediaBySide({
            userCardId: cardId,
            side: "front",
            isSlabbed: frontImage.imageIsSlabbed,
            originalPath: null,
            processedPath: path,
            processingStatus: "cropped",
          });
          setFrontMediaPending(false);
          frontImage.setImageError("");
        } catch {
          anyFailed = true;
          frontImage.setImageError(
            "Card saved, but the front image could not be stored. Press Save again to retry.",
          );
        }
      } else {
        setFrontMediaPending(false);
        setFrontOcrPending(false);
      }
    }

    // OCR persistence for the front side -- independent of whether media
    // needed (re-)uploading this cycle. If front media already succeeded on
    // a previous attempt, frontMediaRow is fetched here instead of re-
    // uploaded. A cached CardOcrResult from the crop-time effect is reused
    // as-is (whether or not it found text -- both are valid completed
    // results); otherwise OCR is (re-)run right here, giving a prior OCR
    // failure a genuine second chance on retry.
    //
    // Production-blocking regression fix: a genuine failure here (runOcr
    // throws, or the update itself fails) does NOT set anyFailed -- this is
    // the ONE thing this block must never do, and a prior "corrected
    // contract" briefly made it do exactly that. Root-caused via a live,
    // authenticated, browser-driven reproduction: the user_cards row and
    // the front image itself are already fully committed by this point in
    // the cycle (createUserCard + the media-upload block above both already
    // succeeded), but re-persisting the OCR text is a purely best-effort,
    // non-essential metadata write (this text was never shown to the user
    // anywhere -- see "successful OCR should be silent"). Letting it set
    // anyFailed made onSave() skip router.push("/cards") and made
    // onSaveAndAddAnother() refuse to advance, leaving the collector stuck
    // on /cards/new looking at a small red retry line while their
    // already-saved card sat, fully visible, one click away on /cards --
    // exactly the "I press Save, the card does not appear in my Binder"
    // report. This now matches the Vision persistence block immediately
    // below, which was already correctly best-effort and never blocked
    // anything -- OCR failing here leaves the row at "cropped" and
    // frontOcrPending true for a later opportunistic retry, precisely like
    // that block's own comment already describes, without blocking save.
    if (needsFrontOcr && frontImage.imageUrl) {
      try {
        if (!frontMediaRow) {
          frontMediaRow = await getCardMediaBySide(cardId, "front");
        }
        if (frontMediaRow) {
          let result = frontOcrResult;
          if (!result) {
            result = await runOcr(frontImage.imageUrl, "front");
            setFrontOcrResult(result);
          }
          await updateCardMedia(frontMediaRow.id, {
            ocrOutput: result as unknown as JsonValue,
            processingStatus: "ocr_complete",
          });
          setFrontOcrPending(false);
          setFrontOcrError("");
        }
      } catch {
        setFrontOcrStatus("failed");
        setFrontOcrError(
          "Card saved, but front text recognition failed. Press Save again to retry.",
        );
      }
    }

    // Vision Engine V3, Phase V3.1B: front vision_output persistence.
    // Deliberately independent of the OCR block above and never
    // contributes to anyFailed -- a missing/invalid/timed-out visual
    // analysis is fully best-effort at save time and must never block
    // save or gate "Save + Add Another"'s full-success check. OCR
    // persistence above now follows this exact same never-blocks-anyFailed
    // contract (see its comment). There is intentionally no
    // pending/retry flag for vision -- a later Save click simply
    // re-attempts this same best-effort block against whatever
    // frontVisionResult/frontVisionRequestRef currently hold, which is
    // idempotent (re-persisting the same already-valid result is a
    // harmless no-op write).
    //
    // processing_status: this write, when it happens, always runs after
    // the OCR block above within the same cycle, so on the row's shared
    // processing_status column the *last* successful write wins. OCR
    // unconditionally writes "ocr_complete" on its own success; vision
    // unconditionally writes "vision_complete" on its own success. The
    // four cases resolve exactly as intended: neither succeeds -> the
    // column stays at whatever upload time set ("cropped"); only OCR
    // succeeds -> "ocr_complete" (this block never writes); only vision
    // succeeds -> this block's write is the only one that happens,
    // correctly overwriting "cropped"; both succeed -> OCR writes
    // "ocr_complete" first, then this block's "vision_complete" write
    // lands after it and is therefore the final, most-advanced truthful
    // value. Neither case ever implies catalog_matched/verified, which
    // this phase never sets.
    if (!isWishlistCard && frontImage.imageUrl) {
      try {
        if (!frontMediaRow) {
          frontMediaRow = await getCardMediaBySide(cardId, "front");
        }
        if (frontMediaRow) {
          const visionResult = await resolveVisionResultForSave({
            imageUrl: frontImage.imageUrl,
            side: "front",
            cachedResult: frontVisionResult,
            cachedImageKey: frontVisionImageKeyRef.current,
            inFlightRequest: frontVisionRequestRef.current,
          });
          if (visionResult) {
            await updateCardMedia(frontMediaRow.id, {
              visionOutput: visionResult as unknown as JsonValue,
              processingStatus: "vision_complete",
            });
            setFrontVisionResult(visionResult);
            frontVisionImageKeyRef.current = frontImage.imageUrl;
          }
        }
      } catch {
        // Best-effort -- see comment above. The row keeps whatever
        // processing_status the OCR block (if it ran) already set, or
        // "cropped" if neither succeeded this cycle.
      }
    }

    if (needsBackMedia) {
      if (backImage.imageUrl) {
        try {
          const { path } = await uploadCardMediaImage({
            profileId,
            userCardId: cardId,
            side: "back",
            dataUrl: backImage.imageUrl,
          });
          backMediaRow = await upsertCardMediaBySide({
            userCardId: cardId,
            side: "back",
            isSlabbed: backImage.imageIsSlabbed,
            originalPath: null,
            processedPath: path,
            processingStatus: "cropped",
          });
          setBackMediaPending(false);
          backImage.setImageError("");
        } catch {
          anyFailed = true;
          backImage.setImageError(
            "Card saved, but the back image could not be stored. Press Save again to retry.",
          );
        }
      } else {
        setBackMediaPending(false);
        setBackOcrPending(false);
      }
    }

    // OCR persistence for the back side -- mirrors the front block above
    // exactly, independently, including the same production-blocking-
    // regression fix: a failure here must never set anyFailed (see the
    // front block's comment for the full root-cause explanation).
    if (needsBackOcr && backImage.imageUrl) {
      try {
        if (!backMediaRow) {
          backMediaRow = await getCardMediaBySide(cardId, "back");
        }
        if (backMediaRow) {
          let result = backOcrResult;
          if (!result) {
            result = await runOcr(backImage.imageUrl, "back");
            setBackOcrResult(result);
          }
          await updateCardMedia(backMediaRow.id, {
            ocrOutput: result as unknown as JsonValue,
            processingStatus: "ocr_complete",
          });
          setBackOcrPending(false);
          setBackOcrError("");
        }
      } catch {
        setBackOcrStatus("failed");
        setBackOcrError(
          "Card saved, but back text recognition failed. Press Save again to retry.",
        );
      }
    }

    // Vision Engine V3, Phase V3.1B: back vision_output persistence --
    // mirrors the front block above exactly, independently. See that
    // block's comment for the full processing_status ordering rationale
    // and why this never contributes to anyFailed.
    if (!isWishlistCard && backImage.imageUrl) {
      try {
        if (!backMediaRow) {
          backMediaRow = await getCardMediaBySide(cardId, "back");
        }
        if (backMediaRow) {
          const visionResult = await resolveVisionResultForSave({
            imageUrl: backImage.imageUrl,
            side: "back",
            cachedResult: backVisionResult,
            cachedImageKey: backVisionImageKeyRef.current,
            inFlightRequest: backVisionRequestRef.current,
          });
          if (visionResult) {
            await updateCardMedia(backMediaRow.id, {
              visionOutput: visionResult as unknown as JsonValue,
              processingStatus: "vision_complete",
            });
            setBackVisionResult(visionResult);
            backVisionImageKeyRef.current = backImage.imageUrl;
          }
        }
      } catch {
        // Best-effort -- see the front block's comment above.
      }
    }

    // Front-only community/shared-image upload -- independent of the
    // private-media retry mechanism above, so a front/back media failure
    // never causes this to run again once it's already been attempted once
    // for this submission.
    if (needsSharedImage) {
      setSharedImagePending(false);
      if (
        !isWishlistCard &&
        frontImage.imageShare &&
        frontImage.imageOwnerConfirm &&
        frontImage.imageUrl &&
        fingerprint &&
        frontImage.imageUrl.trim().length > 0
      ) {
        const res = await saveSharedImage({
          fingerprint,
          dataUrl: frontImage.imageUrl,
          isFront: frontImage.imageIsFront,
          isSlabbed: frontImage.imageIsSlabbed,
          createdAt: new Date().toISOString(),
        });
        if (res.status === "error") {
          frontImage.setImageError(`Shared image upload failed: ${res.message}`);
        } else if (res.status === "exists") {
          frontImage.setImageError("Shared image already exists for this card.");
        }
      }
    }

    return { cardId, succeeded: !anyFailed };
  }

  async function onSave() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await runSaveCycle();
      // Only navigate away once everything pending has synced cleanly --
      // otherwise the user would never see the error set above (this page
      // unmounts on navigation). The card itself is already saved either
      // way, and its id is retained so pressing Save again retries only
      // the pending work instead of creating a second card.
      if (result?.succeeded) {
        router.push("/cards");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function onSaveAndAddAnother() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await runSaveCycle();
      if (!result?.succeeded) {
        // Stay on the page so the user can see the media-sync error above
        // instead of the reset block below immediately clearing it, and so
        // the retained card id lets a retry avoid creating a second card.
        return;
      }

      // reset form (keep your existing reset block EXACTLY as-is, now
      // applied symmetrically to both independent image slots)
      setPlayerName("");
      setCardNumber("");
      setTeam("");
      setLocation("");
      setGradingStatus("RAW");
      setGrader("");
      setGrade("");
      setStatus("HAVE");
      setPurchasePrice("");
      setMarketValue("");
      setPurchaseDate("");
      setVariation("");
      setInsert("");
      setParallel("");
      setSerialNumber("");
      setSerialTotal("");
      setIsRookie(false);
      setIsAutograph(false);
      setIsPatch(false);
      setNotes("");
      frontImage.setImageUrl(null);
      frontImage.setImageIsFront(true);
      frontImage.setImageIsSlabbed(false);
      frontImage.setImageShare(false);
      frontImage.setImageOwnerConfirm(false);
      frontImage.setImageType("front");
      frontImage.setImageError("");
      frontImage.setImageCheckStatus("idle");
      frontImage.setCardPhotoConfirm(false);
      backImage.setImageUrl(null);
      backImage.setImageIsFront(true);
      backImage.setImageIsSlabbed(false);
      backImage.setImageShare(false);
      backImage.setImageOwnerConfirm(false);
      backImage.setImageType("front");
      backImage.setImageError("");
      backImage.setImageCheckStatus("idle");
      backImage.setCardPhotoConfirm(false);
      setChecklistQuery("");
      setChecklistSection("ALL");
      setShowChecklistResults(true);

      // Now that selectedCard.id feeds buildCard()'s catalogCardId (see
      // above), it must not survive into the next card -- otherwise the
      // catalog identity from the card just saved would silently reappear
      // as the "explicit selection" for whatever the collector adds next.
      // setSelectedCard(null) is enough: useCatalogVariantLookup's own
      // render-time reset (keyed on selectedCard?.id) clears selectedVariant
      // and its fetched variant list the moment this takes effect, the same
      // way it already does for any other card-id change. selectedSection/
      // selectedSetId are deliberately left alone, matching this reset
      // block's existing choice not to clear year/setName either -- adding
      // another card from the same set/section is the common case here.
      // The bootstrap's one-time stage guard is already "done" by this
      // point, so this plain reset can't be raced or overridden by it.
      setSelectedCard(null);

      // Vision Engine V2, Phase 5B correction: clear creation/retry state
      // only now that every pending step has actually succeeded and the
      // form has been reset -- the next Save starts a genuinely new card.
      setCreatedCardId(null);
      setLegacyFrontPending(false);
      setFrontMediaPending(false);
      setBackMediaPending(false);
      setSharedImagePending(false);
      // Vision Engine V2, Phase 6A correction: OCR pending flags and cached
      // results reset the same way. By the time this block runs, `result`
      // was already fully successful (including OCR -- see runSaveCycle),
      // so these are already false/null/"idle"; reset here anyway for the
      // next card, consistent with the other pending flags above.
      setFrontOcrPending(false);
      setFrontOcrResult(null);
      setFrontOcrStatus("idle");
      setFrontOcrError("");
      setBackOcrPending(false);
      setBackOcrResult(null);
      setBackOcrStatus("idle");
      setBackOcrError("");

      // Vision Engine V3, Phase V3.1B: vision state reset the same way,
      // for the next card.
      setFrontVisionResult(null);
      frontVisionImageKeyRef.current = null;
      frontVisionRequestRef.current = null;
      setBackVisionResult(null);
      backVisionImageKeyRef.current = null;
      backVisionRequestRef.current = null;

      // Vision Engine V3, Phase V3.5A2: fixes the confirmed "Save and Add
      // Another" bug where manualOverrides leaked into the next card --
      // reset only now that `result.succeeded` is true (every required
      // step, including manual-override persistence, has already
      // completed), matching every other reset above.
      setManualOverrides({});
      setManualOverridesPending(false);
      setManualOverridesError("");
      lastPersistedManualOverridesRef.current = null;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isWishlist ? "Wishlist Search" : "Add Card"}
          </h1>
          <p className="text-sm text-zinc-600">
            {isWishlist
              ? "Find a card to add to your wishlist (not added to your binder)."
              : "Add a new card to your binder."}
          </p>
        </div>
        <Link
          href={isWishlist ? "/cards/wishlist" : "/cards"}
          className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
        >
          Back
        </Link>
      </div>

      <input
        ref={scanInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          frontImage.handleImageFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      {entryMode === "choice" ? (
        <div className="sm:hidden grid gap-3 rounded-xl border bg-white p-6 text-center">
          <button type="button" onClick={handleScanCard} className="btn-primary">
            📷 Scan Card
          </button>
          <button type="button" onClick={() => setEntryMode("form")} className="btn-secondary">
            ⌨ Enter Manually
          </button>
        </div>
      ) : null}

      <div
        className={
          (entryMode === "form" ? "grid " : "hidden ") +
          "gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 sm:grid"
        }
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-zinc-900">Set lookup</label>
          <div className="relative">
            <input
              value={setQuery}
              onChange={(e) => {
                setSetQuery(e.target.value);
                setShowSetResults(true);
              }}
              onFocus={() => setShowSetResults(true)}
              onBlur={() => {
                window.setTimeout(() => setShowSetResults(false), 120);
              }}
              placeholder="Search sets (e.g., 2018 Prizm, Topps Chrome)"
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
            />
            {showSetResults && setResults.length ? (
              <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                {setResults.map((s) => (
                  <button
                    key={`${s.year}-${s.name}-${s.brand ?? ""}-${s.sport ?? ""}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSet(s);
                      if (s.checklistKey) {
                        setChecklistQuery("");
                        setChecklistSection("ALL");
                      }
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    <div className="font-medium text-zinc-900">
                      {formatSetLabel(s)}
                    </div>
                    <div className="text-xs text-zinc-900">
                      {[s.brand, s.sport, s.checklistKey ? "Checklist" : ""]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-900">
            Pick a set to auto-fill <span className="font-medium">Year</span> and{" "}
            <span className="font-medium">Set</span>.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-zinc-900">Catalog match</label>
          {frontOcrStatus === "running" ? (
            <div className="mt-1 text-xs text-zinc-500">Reading card…</div>
          ) : null}
          <div className="relative">
            <input
              value={catalogQuery}
              onChange={(e) => {
                setCatalogQuery(e.target.value);
                setShowCatalogResults(true);
              }}
              onFocus={() => setShowCatalogResults(true)}
              onBlur={() => {
                window.setTimeout(() => setShowCatalogResults(false), 120);
              }}
              placeholder="Search player, set, year, card #..."
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
            />
            {showCatalogResults && debouncedCatalogQuery.trim() ? (
              <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                {catalogLoading ? (
                  <div className="px-3 py-2 text-sm text-zinc-600">Searching…</div>
                ) : catalogResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-600">No cards found.</div>
                ) : (
                  catalogResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectCatalogMatch(result);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-900">
                        {result.playerNames.join(" / ") || result.title || `Card #${result.cardNumber}`}
                      </div>
                      <div className="text-xs text-zinc-900">
                        {[
                          result.releaseYear,
                          result.setName,
                          result.cardNumber ? `#${result.cardNumber}` : "",
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-900">
            Selecting a catalog card fills{" "}
            <span className="font-medium">Player</span>, <span className="font-medium">Year</span>,{" "}
            <span className="font-medium">Set</span>, <span className="font-medium">Card #</span>, and
            the rookie/autograph/patch flags. You can still edit any field afterward.
          </p>
        </div>

        {checklistLoading ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Loading checklist…
          </div>
        ) : activeChecklist.length ? (
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-900">Checklist search</label>
            <div className="relative">
              <input
                value={checklistQuery}
                onChange={(e) => {
                  setChecklistQuery(e.target.value);
                  setShowChecklistResults(true);
                }}
                onFocus={() => setShowChecklistResults(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowChecklistResults(false), 120);
                }}
                placeholder="Search name, number, team..."
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
              />
              {showChecklistResults && checklistResults.length ? (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                  {checklistResults.map((c: ChecklistEntry) => (
                    <button
                      key={`${c.section}-${c.number}-${c.name}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setCardNumber(c.number);
                        setPlayerName(c.name);
                        if (c.team) setTeam(c.team);
                        if (typeof c.section === "string") {
                          if (c.section === "Anniversary Rookies") {
                            setInsert("Anniversary Rookies");
                            setParallel("");
                            setSerialTotal("");
                          }
                          applySectionAutoFill(c.section, setParallel, setSerialTotal, setInsert);
                          const flags = inferFlagsFromSection(c.section);
                          setIsRookie(flags.isRookie);
                          setIsAutograph(flags.isAutograph);
                          setIsPatch(flags.isMemorabilia);
                        }
                        setChecklistQuery(`${c.number} ${c.name}`);
                        setShowChecklistResults(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-900">
                        #{c.number} {c.name}
                      </div>
                      <div className="text-xs text-zinc-900">
                        {[c.team, c.section].filter(Boolean).join(" • ")}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-zinc-900">
              Selecting a card fills <span className="font-medium">Player</span>,{" "}
              <span className="font-medium">Card #</span>, and{" "}
              <span className="font-medium">Team</span>.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setChecklistSection("ALL")}
                className={
                  "min-h-[56px] rounded-lg border px-4 py-3 text-left text-sm transition " +
                  (checklistSection === "ALL"
                    ? "border-zinc-900 bg-[var(--brand-primary)] text-white"
                    : "border-zinc-400 bg-white text-zinc-900 hover:bg-zinc-50")
                }
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80 truncate">All</div>
                <div className="text-base font-semibold">{activeChecklist.length}</div>
              </button>

              {checklistGroups.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setChecklistSection(g.label)}
                className={
                  "min-h-[56px] rounded-lg border px-4 py-3 text-left text-sm transition " +
                  (checklistSection === g.label
                    ? "border-zinc-900 bg-[var(--brand-primary)] text-white"
                    : "border-zinc-400 bg-white text-zinc-900 hover:bg-zinc-50")
                }
              >
                  <div className="text-[11px] uppercase tracking-wide opacity-80 truncate">
                    {g.label}
                  </div>
                  <div className="text-base font-semibold">{g.count}</div>
                </button>
              ))}
            </div>
          </div>
        ) : setName.trim() && year.trim() ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Checklist is only available after selecting a set with a checklist.
          </div>
        ) : null}

        {catalogPreselectStatus === "loading" ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Loading catalog card…
          </div>
        ) : catalogPreselectStatus === "error" ? (
          <div className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            We couldn&apos;t load that catalog card. You can still select a card manually.
          </div>
        ) : null}

        {checklistSectionsLoading ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Loading sections…
          </div>
        ) : checklistSectionOptions.length > 0 ? (
          <div className="sm:col-span-2">
            <Select
              label="Section (optional)"
              value={selectedSection ? String(selectedSection.id) : ""}
              onChange={(v) => {
                const section = checklistSectionOptions.find((s) => String(s.id) === v) ?? null;
                setSelectedSection(section);
              }}
              options={[
                ["", "None"],
                ...checklistSectionOptions.map(
                  (s) => [String(s.id), s.name] as [string, string]
                ),
              ]}
            />
          </div>
        ) : null}

        {selectedSection ? (
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-900">Card (optional)</label>
            {catalogCardsLoading ? (
              <div className="mt-1 text-xs text-zinc-500">Loading cards…</div>
            ) : null}
            <div className="relative">
              <input
                value={catalogCardQuery}
                onChange={(e) => {
                  setCatalogCardQuery(e.target.value);
                  setShowCatalogCardResults(true);
                }}
                onFocus={() => setShowCatalogCardResults(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowCatalogCardResults(false), 120);
                }}
                placeholder="Search card number or title..."
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
              />
              {showCatalogCardResults && catalogCardOptions.length ? (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                  {catalogCardOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        // Save-identity precedence fix (Phase A): an
                        // explicit manual card pick is a more recent,
                        // equally-exact identity choice than any earlier
                        // scan candidate -- clear it (same helper the
                        // candidate panel's own "Clear selection" button
                        // uses) so buildCard()'s precedence correctly falls
                        // through to this selection instead of continuing
                        // to save a stale candidate's cardId.
                        clearSelectedCandidate();
                        setSelectedCard(c);
                        // Identity-ownership fix (Phase B): c (CardSummary)
                        // carries only id/card_number/title -- no player/
                        // year/set -- so those three can't be corrected
                        // here (left exactly as the user already typed them
                        // to reach this section/card). card_number IS
                        // trustworthy exact data this handler wasn't
                        // previously applying at all. parallel/autograph/
                        // patch are reset to a clean baseline for the same
                        // reason applyCandidateSelection resets them: a
                        // previously selected variant's flags belong to
                        // whatever card was active before and must not
                        // silently carry over onto this different exact
                        // card.
                        setCardNumber(c.card_number);
                        setParallel("");
                        setIsAutograph(false);
                        setIsPatch(false);
                        setCatalogCardQuery(`#${c.card_number}${c.title ? ` - ${c.title}` : ""}`);
                        setShowCatalogCardResults(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-900">
                        #{c.card_number}
                        {c.title ? ` - ${c.title}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Add Card scan UX simplification, Phase D: unchanged manual
            lookup box, but now also gated on !selectedCandidate -- an
            earlier manual Card pick that's since been superseded by an
            explicitly chosen scan candidate (selectedCandidate now
            authoritative per Phase A/B) leaves selectedCard set to a
            stale card; without this it would keep showing this box
            underneath an unrelated "Card identified" candidate. */}
        {selectedCard && !selectedCandidate ? (
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-900">
              Parallel / Variant (optional)
            </label>
            {catalogVariantsLoading ? (
              <div className="mt-1 text-xs text-zinc-500">Loading variants…</div>
            ) : null}
            <div className="relative">
              <input
                value={catalogVariantQuery}
                onChange={(e) => {
                  setCatalogVariantQuery(e.target.value);
                  setShowCatalogVariantResults(true);
                }}
                onFocus={() => setShowCatalogVariantResults(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowCatalogVariantResults(false), 120);
                }}
                placeholder="Search parallel, print run, or descriptor..."
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
              />
              {showCatalogVariantResults && catalogVariantOptions.length ? (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                  {catalogVariantOptions.map((v) => {
                    const label = [
                      v.parallelName ?? "Base",
                      v.printRun ? `/${v.printRun}` : "",
                      v.swatchDescriptor ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const flags = [v.hasAutograph ? "AU" : "", v.hasMemorabilia ? "MEM" : ""]
                      .filter(Boolean)
                      .join(" • ");
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedVariant(v);
                          setCatalogVariantQuery(label);
                          setShowCatalogVariantResults(false);
                          // Fills the existing Parallel field and
                          // autograph/memorabilia checkboxes -- these
                          // already flow into buildCard()/save exactly as
                          // when filled by catalog match or checklist
                          // selection, so no save-logic change is needed.
                          // (Phase D: now via the shared applyVariantSelection
                          // primitive, reused by the new candidate-flow
                          // variant refinement below -- same fields, same
                          // effect, no duplicated assignment logic.)
                          applyVariantSelection(v);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                      >
                        <div className="font-medium text-zinc-900">{label}</div>
                        {flags ? <div className="text-xs text-zinc-900">{flags}</div> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-zinc-900">
              Selecting a variant fills <span className="font-medium">Parallel</span> and the{" "}
              <span className="font-medium">Autograph</span>/
              <span className="font-medium">Patch/Relic</span> checkboxes. You can still edit them
              afterward.
            </p>
          </div>
        ) : null}

        {!isWishlistCard ? (
          <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
            <div>
              <CardImageUploader
                label="Front Image"
                side={frontImage.side}
                imageUrl={frontImage.imageUrl}
                setImageUrl={frontImage.setImageUrl}
                imageType={frontImage.imageType}
                setImageType={frontImage.setImageType}
                setImageIsFront={frontImage.setImageIsFront}
                setImageIsSlabbed={frontImage.setImageIsSlabbed}
                cardPhotoConfirm={frontImage.cardPhotoConfirm}
                setCardPhotoConfirm={frontImage.setCardPhotoConfirm}
                setImageOwnerConfirm={frontImage.setImageOwnerConfirm}
                setImageShare={frontImage.setImageShare}
                imageError={frontImage.imageError}
                imageCheckStatus={frontImage.imageCheckStatus}
                sharedImage={sharedImage}
                reportInfo={reportInfo}
                fingerprint={fingerprint}
                onFileSelected={frontImage.handleImageFile}
              />
              {ocrStatusLabel("front", frontOcrStatus) ? (
                <div className="mt-1 text-xs text-zinc-500">
                  {ocrStatusLabel("front", frontOcrStatus)}
                </div>
              ) : null}
              {frontOcrError ? (
                <div className="mt-1 text-xs text-red-600">{frontOcrError}</div>
              ) : null}
              {/* Add Card scan UX simplification, Phase E: the ONE
                  concise, actionable line shown when this side's photo
                  genuinely prevents a reliable scan -- see
                  getImageRetakeGuidance's own doc comment for exactly what
                  does/doesn't trigger it. Independent of the back side's
                  own message below; never affects OCR/candidate/save. */}
              {frontVisionResult && getImageRetakeGuidance("front", frontVisionResult) ? (
                <div className="mt-1 text-xs text-amber-700">
                  {getImageRetakeGuidance("front", frontVisionResult)}
                </div>
              ) : null}
            </div>

            {/* Back Image: independent slot. No community-image lookup
                exists for a back photo yet, since the shared-image feature
                is keyed by a single card-identity fingerprint today. */}
            <div>
              <CardImageUploader
                label="Back Image"
                side={backImage.side}
                imageUrl={backImage.imageUrl}
                setImageUrl={backImage.setImageUrl}
                imageType={backImage.imageType}
                setImageType={backImage.setImageType}
                setImageIsFront={backImage.setImageIsFront}
                setImageIsSlabbed={backImage.setImageIsSlabbed}
                cardPhotoConfirm={backImage.cardPhotoConfirm}
                setCardPhotoConfirm={backImage.setCardPhotoConfirm}
                setImageOwnerConfirm={backImage.setImageOwnerConfirm}
                setImageShare={backImage.setImageShare}
                imageError={backImage.imageError}
                imageCheckStatus={backImage.imageCheckStatus}
                sharedImage={null}
                reportInfo={null}
                fingerprint=""
                onFileSelected={backImage.handleImageFile}
              />
              {ocrStatusLabel("back", backOcrStatus) ? (
                <div className="mt-1 text-xs text-zinc-500">
                  {ocrStatusLabel("back", backOcrStatus)}
                </div>
              ) : null}
              {backOcrError ? (
                <div className="mt-1 text-xs text-red-600">{backOcrError}</div>
              ) : null}
              {backVisionResult && getImageRetakeGuidance("back", backVisionResult) ? (
                <div className="mt-1 text-xs text-amber-700">
                  {getImageRetakeGuidance("back", backVisionResult)}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Add Card scan UX simplification, Phase F: the routine
            "Combined OCR ready — N field conflict(s)" line that used to
            render here unconditionally (once either side's OCR completed)
            was removed -- it exposed an internal fusion diagnostic
            (mergedOcr.conflictCount) that a collector has no use for and
            that never, by itself, meant the card couldn't be identified
            (see the real Select Future production example: 1 field
            conflict, exact card still identified correctly). Per-side
            progress/failure text (ocrStatusLabel, rendered under each
            uploader above) already covers genuinely useful OCR status
            (reading/detected/no text/failed) and is unchanged. mergedOcr
            itself is untouched -- still the sole input to searchCycleKey
            and the candidate-search effect's early-return gate above. */}

        {/* Add Card scan UX simplification, Phase C (wording updated in
            Phase I): the normal path shows a concise "Card identified"
            summary (canonical identity only -- no score/confidence/
            recommendation/field-quality, which remain internal-only, still
            fully computed via confidenceAssessments/candidateAutoSelected,
            just not rendered here) plus a "Change card" disclosure.
            Phase I made the top-ranked candidate (candidateResults[0])
            apply automatically whenever at least one candidate exists
            (see shouldAutoApplyTopCandidate above) -- confidence/
            safe-preselection no longer gates this at all, so
            selectedCandidate === null with candidateResults.length > 0 now
            means the user deliberately cleared/rejected the automatic
            match (via "None of these" below), not that the system
            declined to guess. Selecting an alternative reuses
            selectCandidateManually / applyCandidateSelection unchanged --
            Phase A/B still own save identity and form population; this
            phase only changes what's visible and when. */}
        {!isWishlistCard && candidateResults.length > 0 ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 p-3 text-xs text-zinc-700">
            {selectedCandidate ? (
              <>
                <div className="font-semibold text-zinc-900">Card identified</div>
                <div className="mt-1">
                  <CandidateSummary candidate={selectedCandidate} />
                </div>
                {/* Add Card scan UX simplification, Phase D: only ever
                    shows a GENUINELY selected variant (selectedVariantCandidate,
                    set exclusively by an explicit pick below) -- never the
                    merely top-ranked, unaccepted entry from variantResults.
                    "ranked first" must never be presented as "identified". */}
                {selectedVariantCandidate ? (
                  <div className="mt-1 text-zinc-600">
                    {[
                      selectedVariantCandidate.parallelName ?? "Base (no parallel)",
                      selectedVariantCandidate.printRun ? `/${selectedVariantCandidate.printRun}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    {selectedVariantCandidate.hasAutograph || selectedVariantCandidate.hasMemorabilia
                      ? " • " +
                        [
                          selectedVariantCandidate.hasAutograph ? "Autograph" : "",
                          selectedVariantCandidate.hasMemorabilia ? "Memorabilia" : "",
                        ]
                          .filter(Boolean)
                          .join(" • ")
                      : ""}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCandidateAlternatives((prev) => !prev)}
                    aria-expanded={showCandidateAlternatives}
                    aria-controls="candidate-alternatives"
                    className="text-blue-700 underline"
                  >
                    Change card
                  </button>
                  {/* Add Card scan UX simplification, Phase D: only offered
                      when there is something meaningful to choose from
                      (existing ranked variantResults data, no new query) --
                      a card with no catalog variants gets no useless
                      refinement control (Step 12). */}
                  {variantResults.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowVariantRefinement((prev) => !prev)}
                      aria-expanded={showVariantRefinement}
                      aria-controls="variant-refinement"
                      className="text-blue-700 underline"
                    >
                      Choose parallel / variant
                    </button>
                  ) : null}
                </div>
                {showVariantRefinement ? (
                  <div
                    id="variant-refinement"
                    className="mt-3 max-h-80 space-y-2 overflow-y-auto border-t border-zinc-200 pt-3"
                  >
                    {variantsLoading ? (
                      <div className="text-zinc-500">Loading variants…</div>
                    ) : variantsError ? (
                      <div className="text-red-600">Couldn&apos;t load variants for this card.</div>
                    ) : (
                      // Correction (Phase D review): ranking still determines
                      // ORDER (variantResults is already sorted best-first by
                      // rankCardVariants, untouched here), but once the user
                      // has deliberately opened this correction flow, ranking
                      // must not control ELIGIBILITY -- every real catalog
                      // variant already present in variantResults is
                      // rendered, not just the top 5. A card like 5095
                      // (Select Future, 8 real variants) must let the
                      // collector pick #6/#7/#8 if that's the one OCR/Vision
                      // evidence under-ranked. No new cap, no pagination, no
                      // auto-selection -- just no arbitrary truncation of an
                      // already-complete, already-correctly-ordered list.
                      variantResults.map((variant) => {
                        const isActive = selectedVariantCandidate?.variantId === variant.variantId;
                        return (
                          <div
                            key={variant.variantId}
                            className={
                              "rounded border bg-white p-2 " +
                              (isActive ? "border-zinc-900" : "border-zinc-200")
                            }
                          >
                            <div className="font-medium text-zinc-800">
                              {variant.parallelName ?? "Base (no parallel)"}
                              {variant.printRun ? ` • /${variant.printRun}` : ""}
                            </div>
                            <div className="text-zinc-500">
                              {[
                                variant.hasAutograph ? "Autograph" : null,
                                variant.hasMemorabilia ? "Memorabilia" : null,
                                variant.swatchDescriptor,
                              ]
                                .filter(Boolean)
                                .join(" • ") || "No additional attributes"}
                            </div>
                            <button
                              type="button"
                              disabled={isActive}
                              onClick={() => {
                                applyVariantSelection(variant);
                                setSelectedVariantCandidate(variant);
                                setShowVariantRefinement(false);
                              }}
                              className="mt-1 text-blue-700 underline disabled:cursor-default disabled:text-zinc-400 disabled:no-underline"
                            >
                              {isActive ? "Currently selected" : "Select this variant"}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {/* Add Card scan UX simplification, Phase I: with the top
                    candidate now applying automatically whenever any exist
                    (see above), this branch is reached only right after the
                    user deliberately clears/rejects that automatic match
                    (the "None of these" action below) -- never because
                    confidence was merely imperfect -- so the copy no longer
                    claims TheBinder "couldn't confirm one automatically". */}
                <div className="font-semibold text-zinc-900">No card selected</div>
                <div className="mt-1 text-zinc-500">
                  Choose the matching card below, or enter this card manually.
                </div>
              </>
            )}

            {showCandidateAlternatives || !selectedCandidate ? (
              <div id="candidate-alternatives" className="mt-3 space-y-2 border-t border-zinc-200 pt-3">
                {candidateResults.map((candidate) => {
                  const isActive = selectedCandidate?.cardId === candidate.cardId;
                  return (
                    <div
                      key={candidate.cardId}
                      className={
                        "rounded border bg-white p-2 " +
                        (isActive ? "border-zinc-900" : "border-zinc-200")
                      }
                    >
                      <CandidateSummary candidate={candidate} />
                      <button
                        type="button"
                        disabled={isActive}
                        onClick={() => {
                          selectCandidateManually(candidate);
                          setShowCandidateAlternatives(false);
                        }}
                        className="mt-1 text-blue-700 underline disabled:cursor-default disabled:text-zinc-400 disabled:no-underline"
                      >
                        {isActive ? "Currently selected" : "Select this card"}
                      </button>
                    </div>
                  );
                })}
                {selectedCandidate ? (
                  // Add Card scan UX simplification, Phase I: the escape
                  // hatch for "none of these candidates are correct" --
                  // clearSelectedCandidate() (unchanged) sets selectedCandidate
                  // to null, which is Phase A's OTHER catalogCardId input
                  // (selectedCandidate?.cardId ?? selectedCard?.id) already
                  // becoming null/undefined here too (selectedCard is a
                  // separate manual-lookup state this flow never touches) --
                  // so the previously automatically-applied candidate loses
                  // canonical save authority immediately, satisfying this
                  // phase's mandatory "manual fallback must remove the
                  // candidate's canonical save authority" requirement with
                  // no new state. The form fields it already populated stay
                  // as an editable starting point -- the existing Field
                  // inputs and manual catalog search below remain the
                  // fallback, per Step 14 (no new manual-entry system).
                  <button
                    type="button"
                    onClick={() => {
                      clearSelectedCandidate();
                      setShowCandidateAlternatives(false);
                    }}
                    className="text-zinc-600 underline"
                  >
                    None of these — enter card manually
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Add Card scan UX simplification, Phase D: the always-visible,
            read-only "Possible Variants" panel that used to render here
            unconditionally (for the selected candidate, or the merely
            top-ranked one when nothing was selected yet) was removed --
            its exact same data (variantResults) and interaction is now
            served by the "Choose parallel / variant" disclosure inside the
            "Card identified" summary above, reachable only once an exact
            card is actually selected (Step 13: no variant choices before
            the card itself is resolved) and only deliberately (Step 6),
            never permanently. variantResults/variantsLoading/variantsError
            and their underlying fetch/ranking are entirely unchanged --
            only this redundant, always-on rendering was deleted. */}

        {/* Add Card scan UX simplification, Phase E: the always-visible
            "Visual Analysis" panel (dominant/border color, glare,
            lighting, orientation, warnings) that used to render here for
            both sides was removed. frontVisionResult/backVisionResult are
            unchanged as state -- still populated by the unmodified vision
            effects, still fed into displayEvidence/rankCardVariants
            exactly as before -- and their one collector-facing signal
            (a retake instruction when a side's photo genuinely prevents a
            reliable scan) now renders directly under that side's own
            uploader instead of in a separate combined technical panel;
            see getImageRetakeGuidance. */}

        {/* Add Card scan UX simplification, Phase F: the always-visible,
            full field-by-field "Evidence Inspector" (state/confidence/
            source badges, raw supporting observations, every conflict --
            identity and purely visual alike -- and a free-text override
            editor for every field) no longer renders during the normal
            path. displayEvidence/fullFusedEvidence/manualOverrides remain
            exactly as before -- still the single evidence object driving
            candidate search, candidate confidence, and variant ranking --
            only this routine, always-on UI surface was removed (the
            EvidenceInspector/EvidenceFieldCard components themselves are
            untouched and still available, just no longer rendered here).
            The only evidence-conflict surface a collector can now see is
            the minimal prompt directly below, and only when TheBinder
            genuinely cannot identify the card without their help. */}

        {/* Add Card scan UX simplification, Phase F: minimal, targeted
            "we need one detail" intervention -- Case D from this phase's
            spec. Gated on ALL of: an exact card is not already selected
            (!selectedCandidate -- Case A/B stay silent regardless of any
            conflict), there is no candidate list for Phase C's "Choose the
            matching card" chooser to show instead (candidateResults.length
            === 0 -- Case C's own chooser is preferred whenever it exists),
            and at least one genuinely identity-relevant field is actually
            conflicted (identityFieldConflicts.length > 0, computed above --
            Case E's non-identity conflicts, e.g. dominant color, can never
            appear here). Reuses handleEvidenceOverride's existing write-back
            path unchanged -- no new state system -- so answering here can
            itself surface new candidates (displayEvidence changes ->
            candidate search re-runs), at which point this prompt
            disappears on its own (candidateResults.length becomes > 0) in
            favor of Phase C's normal identified/choose-a-card UI. If no
            identity-relevant field is actually conflicted, nothing renders
            here at all and the manual form fields below remain the
            fallback (Step 14). */}
        {!isWishlistCard && !selectedCandidate && candidateResults.length === 0 && identityFieldConflicts.length > 0 ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Confirm a card detail</div>
            <div className="mt-1 text-zinc-500">
              TheBinder found conflicting information and needs your help identifying this card.
            </div>
            <div className="mt-3 space-y-3">
              {identityFieldConflicts.map(({ field, label, values }) => (
                <div key={field}>
                  <div className="font-medium text-zinc-800">{label}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {values.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => applyIdentityConflictResolution(field, value)}
                        className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100"
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {manualOverridesError ? (
              <div className="mt-2 text-xs text-red-600">{manualOverridesError}</div>
            ) : null}
          </div>
        ) : null}

        <Field label="Player" value={playerName} onChange={setPlayerName} placeholder="Baker Mayfield" />

        <Field label="Year" value={year} onChange={setYear} placeholder="2018" />
        <Field label="Set" value={setName} onChange={setSetName} placeholder="Panini Prizm" />
        <Field label="Card #" value={cardNumber} onChange={setCardNumber} placeholder="123" />
        <Field label="Team" value={team} onChange={setTeam} placeholder="Browns" />

        {!isWishlistCard ? (
          <div>
            <label className="block text-xs font-medium text-zinc-600">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Binder A / Box 1 / Safe"
              list="location-options"
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
            />
            <datalist id="location-options">
              {locationOptions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>
        ) : null}

        <Select
          label="Condition"
          value={gradingStatus}
          onChange={(v) => setGradingStatus(v as GradingStatus)}
          options={[
            ["RAW", "Raw"],
            ["GRADED", "Graded"],
          ]}
        />

        {/* ✅ Only show grading fields when needed (no empty grid gaps) */}
        {gradingStatus === "GRADED" ? (
          <>
            <Field label="Grader" value={grader} onChange={setGrader} placeholder="PSA" />
            <Field label="Grade" value={grade} onChange={setGrade} placeholder="10" />
          </>
        ) : null}

        {!isWishlist ? (
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as CardStatus)}
            options={[
              ["HAVE", "Have"],
              ["WANT", "Want"],
              ["FOR_SALE", "For Sale"],
              ["SOLD", "Sold"],
            ]}
          />
        ) : null}

        {!isWishlistCard ? (
          <>
            <Field label="Paid" value={purchasePrice} onChange={setPurchasePrice} placeholder="50" />
            <Field
              label="Market value"
              value={marketValue}
              onChange={setMarketValue}
              placeholder="65"
            />
            <Field label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} type="date" />
          </>
        ) : null}

        <div className="sm:col-span-2 mt-2 border-t pt-4">
          <div className="text-sm font-medium text-zinc-900">Variations / Parallels</div>
          <div className="text-xs text-zinc-500">
            Examples: Base, Silver, Refractor, X-Fractor, Wave, Pink, /99, etc.
          </div>
        </div>

        <Field label="Variation" value={variation} onChange={setVariation} placeholder="Refractor" />
        <Field label="Insert" value={insert} onChange={setInsert} placeholder="Kaboom" />
        <Field
          label="Parallel"
          value={parallel}
          onChange={(v) => {
            setParallel(v);
            const match = v.match(/\/\s*(\d+)\b/);
            if (match) setSerialTotal(match[1]);
          }}
          placeholder="Pink Wave /99"
        />

        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
          <Check label="Rookie" checked={isRookie} onChange={setIsRookie} />
          <Check label="Autograph" checked={isAutograph} onChange={setIsAutograph} />
          <Check label="Patch/Relic" checked={isPatch} onChange={setIsPatch} />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-zinc-900">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400"
            rows={3}
            placeholder="Any extra details…"
          />
        </div>

        {/* Add Card presentation cleanup: ONE cohesive community-reference
            section for the card (front + back together), replacing the two
            near-identical "Community reference" boxes that used to render
            separately under each of the Front/Back CardImageUploaders. Still
            reads/writes exactly the same state and gates on exactly the same
            conditions as before (frontImage.imageOwnerConfirm/imageShare,
            enabled only once an image exists and ownership is confirmed) --
            only where/how often it's shown changed.
            Bound to frontImage only, not "whichever side has an image":
            saveSharedImage()/buildCard()'s imageShared field above are (and
            remain) front-only -- the shared-image/community-reference
            feature is keyed by a single per-card fingerprint that only the
            front slot's OCR feeds (see the "No community-image lookup exists
            for a back photo yet" comment on the Back Image uploader below),
            so backImage.imageOwnerConfirm/imageShare were never actually
            read by any save/storage path even when they had their own
            checkboxes. This section's single consent therefore already
            covers everything that can genuinely be shared today; it isn't
            hiding a real back-image capability. */}
        {!isWishlistCard ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 p-3 text-xs text-zinc-600">
            <div className="text-sm font-medium text-zinc-900">
              Help improve card identification
            </div>
            <div className="mt-1">
              Allow this card&apos;s photo to be used as a community reference image, to help
              identify this card for other collectors.
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={frontImage.imageOwnerConfirm}
                  onChange={(e) => frontImage.setImageOwnerConfirm(e.target.checked)}
                />
                I own this photo
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!frontImage.imageOwnerConfirm || !frontImage.imageUrl}
                  checked={frontImage.imageShare}
                  onChange={(e) => frontImage.setImageShare(e.target.checked)}
                />
                Allow as community reference
              </label>
            </div>
          </div>
        ) : null}

        {/* Vision Engine V3 responsive fix (Phase 1C): stacked full-width
            below sm: (three buttons in one non-wrapping row overflowed at
            phone widths -- the longest simultaneous combination is actually
            both "Retry Processing" labels during a pending retry, not the
            default "Save + Add Another"/"Save Card" pair), back to the
            original compact right-aligned row at sm: and up. DOM order,
            handlers, disabled logic, and label text are all unchanged --
            only how the row wraps/sizes changed. */}
        <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            href={isWishlist ? "/cards/wishlist" : "/cards"}
            className="btn-secondary w-full sm:w-auto"
          >
            Cancel
          </Link>
          <button
            onClick={onSaveAndAddAnother}
            disabled={!canSave || isSaving}
            className="btn-secondary w-full sm:w-auto"
          >
            {isSaving
              ? "Saving…"
              : hasPendingRetry
              ? "Retry Processing"
              : isWishlist
              ? "Add + Another"
              : "Save + Add Another"}
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="btn-primary w-full sm:w-auto"
          >
            {isSaving
              ? "Saving…"
              : hasPendingRetry
              ? "Retry Processing"
              : isWishlist
              ? "Add to Wishlist"
              : "Save Card"}
          </button>
        </div>
      </div>

      <CardImageCropModal
        show={frontImage.showCrop}
        cropData={frontImage.cropData}
        setCropData={frontImage.setCropData}
        setCropSource={frontImage.setCropSource}
        setShowCrop={frontImage.setShowCrop}
        setImageCheckStatus={frontImage.setImageCheckStatus}
        setImageError={frontImage.setImageError}
        cropOffset={frontImage.cropOffset}
        setCropOffset={frontImage.setCropOffset}
        cropDragRef={frontImage.cropDragRef}
        clampCropOffset={frontImage.clampCropOffset}
        cropZoom={frontImage.cropZoom}
        setCropZoom={frontImage.setCropZoom}
        cropRotationBase={frontImage.cropRotationBase}
        cropRotationFine={frontImage.cropRotationFine}
        applyCropRotation={frontImage.applyCropRotation}
        confirmCrop={handleConfirmFrontCrop}
        cropBoxWidth={frontImage.cropBoxWidth}
        cropBoxHeight={frontImage.cropBoxHeight}
        cropZoomMin={frontImage.cropZoomMin}
        cropZoomMax={frontImage.cropZoomMax}
        cropRotationFineMin={frontImage.cropRotationFineMin}
        cropRotationFineMax={frontImage.cropRotationFineMax}
      />

      {/* Independent crop flow for the back slot -- its crop state never
          affects the front slot's modal above, and vice versa. */}
      <CardImageCropModal
        show={backImage.showCrop}
        cropData={backImage.cropData}
        setCropData={backImage.setCropData}
        setCropSource={backImage.setCropSource}
        setShowCrop={backImage.setShowCrop}
        setImageCheckStatus={backImage.setImageCheckStatus}
        setImageError={backImage.setImageError}
        cropOffset={backImage.cropOffset}
        setCropOffset={backImage.setCropOffset}
        cropDragRef={backImage.cropDragRef}
        clampCropOffset={backImage.clampCropOffset}
        cropZoom={backImage.cropZoom}
        setCropZoom={backImage.setCropZoom}
        cropRotationBase={backImage.cropRotationBase}
        cropRotationFine={backImage.cropRotationFine}
        applyCropRotation={backImage.applyCropRotation}
        confirmCrop={handleConfirmBackCrop}
        cropBoxWidth={backImage.cropBoxWidth}
        cropBoxHeight={backImage.cropBoxHeight}
        cropZoomMin={backImage.cropZoomMin}
        cropZoomMax={backImage.cropZoomMax}
        cropRotationFineMin={backImage.cropRotationFineMin}
        cropRotationFineMax={backImage.cropRotationFineMax}
      />
    </div>
  );
}

export default function NewCardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-10 pt-6">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
        </div>
      }
    >
      <NewCardPageInner />
    </Suspense>
  );
}
