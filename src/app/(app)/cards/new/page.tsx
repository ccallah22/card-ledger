"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { GradingStatus, CardStatus } from "@/lib/types";
import { type MyCardInput, createMyCard } from "@/lib/repositories/myCards";
import { searchCatalog, type CardWithContext } from "@/lib/repositories/cards";
import { findSetBySlug } from "@/lib/repositories/sets";
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
import { findCatalogCandidates, type CatalogCandidate } from "@/lib/catalog/candidateEngine";
import {
  assessCandidateConfidence,
  getTopConfidenceAssessment,
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

// Vision Engine V2, Phase 7B: display-only labels for the confidence
// summary below -- never exposes internal formulas/raw JSON, just a
// concise recommendation word and a handful of the most important
// per-field match qualities.
const RECOMMENDATION_LABELS: Record<
  "insufficient_evidence" | "review" | "strong_match" | "safe_to_preselect",
  string
> = {
  insufficient_evidence: "Insufficient evidence",
  review: "Review required",
  strong_match: "Strong match",
  safe_to_preselect: "Safe to preselect",
};

const IMPORTANT_CONFIDENCE_FIELDS = new Set(["player", "cardNumber", "set", "parallel"]);

const CONFIDENCE_FIELD_LABELS: Record<string, string> = {
  player: "Player",
  cardNumber: "Card number",
  set: "Set",
  year: "Year",
  brand: "Brand",
  parallel: "Parallel",
  misc: "Title",
};

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

// Vision Engine V2, Phase 6A correction: minimal, side-specific OCR status
// text -- never exposes raw model JSON/extracted fields, just a concise
// state. "done" always means a genuinely successful, completed OCR
// attempt -- it may have found no text (a valid, neutral outcome), which
// is distinct from "failed" (the request/response itself was invalid).
function ocrStatusLabel(
  side: "front" | "back",
  status: "idle" | "running" | "done" | "failed",
  result: CardOcrResult | null,
): string {
  const label = side === "front" ? "Front" : "Back";
  if (status === "running") return `Reading ${side}…`;
  if (status === "failed") return `${label} OCR failed`;
  if (status === "done") {
    return result?.rawText ? `${label} text detected` : "No readable text detected";
  }
  return "";
}

function NewCardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWishlist = searchParams.get("wishlist") === "1";
  const isForSaleIntent = searchParams.get("forSale") === "1";

  // Mobile-only "Scan Card" / "Enter Manually" entry choice. Desktop always
  // shows the form regardless of this state (see the className toggles
  // below), so the default here only matters for the mobile-width case.
  const [entryMode, setEntryMode] = useState<"choice" | "form">("choice");
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
    selectedVariant,
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
        if (!suppressOpen) {
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
          if (shouldAutoSelect(trimmed, ranked)) {
            fillFieldsFromCatalogMatch(ranked[0]);
          }
        }
      })
      .catch(() => {
        if (!active) return;
        setCatalogResults([]);
        if (!suppressOpen) setShowCatalogResults(true);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedCatalogQuery]);

  function fillFieldsFromCatalogMatch(result: CardWithContext) {
    setPlayerName(result.playerNames.join(" / "));
    if (result.releaseYear != null) setYear(String(result.releaseYear));
    if (result.setName) setSetName(result.setName);
    setCardNumber(result.cardNumber);
    setIsRookie(result.rookieCard);
    setIsAutograph(result.isAutograph);
    setIsPatch(result.isMemorabilia);
  }

  function selectCatalogMatch(result: CardWithContext) {
    fillFieldsFromCatalogMatch(result);
    suppressNextDropdownOpenRef.current = true;
    setCatalogQuery(`${result.cardNumber} ${result.playerNames.join(" / ")}`.trim());
    setShowCatalogResults(false);
  }

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

  async function handleConfirmFrontCrop() {
    pendingFrontOcrRef.current = true;
    setFrontOcrResult(null);
    await frontImage.confirmCrop();
  }

  async function handleConfirmBackCrop() {
    pendingBackOcrRef.current = true;
    setBackOcrResult(null);
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

  // Vision Engine V2, Phase 6B: pure, in-memory reconciliation of the two
  // independent side results -- never persisted (front/back card_media.
  // ocr_output are untouched), and not yet wired into catalog matching.
  // Catalog autofill below still uses the front-only OCR result directly
  // via toLegacyOcrResult, unchanged from before this task.
  const mergedOcr = useMemo(
    () => mergeCardOcrResults(frontOcrResult, backOcrResult),
    [frontOcrResult, backOcrResult],
  );

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

    findCatalogCandidates(mergedOcr)
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
  }, [mergedOcr, searchCycleKey]);

  // Vision Engine V2, Phase 7B: candidate confidence/explainability. Pure
  // and synchronous (unlike candidate search, it never touches the
  // database -- it only re-examines mergedOcr + the already-fetched
  // candidateResults), so a plain useMemo is enough.
  const confidenceAssessments = useMemo(
    () => assessCandidateConfidence(mergedOcr, candidateResults),
    [mergedOcr, candidateResults],
  );
  const topConfidenceAssessment = getTopConfidenceAssessment(confidenceAssessments);

  // Vision Engine V2, Phase 7C: safe candidate preselection. selectedCandidate
  // is the one, shared source of truth for "is a candidate selected" --
  // used both by manual selection (selectCandidateManually/
  // clearSelectedCandidate below) and by automatic preselection, so there
  // is exactly one field-population code path for both
  // (applyCandidateSelection). candidateAutoSelected only affects the
  // read-only notice text; it never gates any behavior.
  const [selectedCandidate, setSelectedCandidate] = useState<CatalogCandidate | null>(null);
  const [candidateAutoSelected, setCandidateAutoSelected] = useState(false);

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
  }, [searchCycleKey]);

  // Shared selection/field-population code path -- the ONE place that
  // writes candidate fields onto the form, used identically by manual
  // selection and by automatic preselection below. Only fills the fields
  // CatalogCandidate actually carries (playerName/year/setName/cardNumber/
  // parallel); never touches catalogQuery, never saves, never mutates the
  // catalog.
  function applyCandidateSelection(candidate: CatalogCandidate) {
    setPlayerName(candidate.playerName ?? "");
    if (candidate.year) setYear(candidate.year);
    if (candidate.setName) setSetName(candidate.setName);
    setCardNumber(candidate.cardNumber);
    if (candidate.parallel) setParallel(candidate.parallel);
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

  // Vision Engine V2, Phase 7C: automatic preselection of the top
  // candidate -- ONLY when every one of these holds:
  //  - not a wishlist card (candidate search/fields aren't shown there)
  //  - the top candidate's recommendation is exactly "safe_to_preselect"
  //  - candidateResults has finished loading FOR THIS cycle
  //    (resolvedCandidateCycleKey === searchCycleKey guards against acting
  //    on a stale array while a new search is still in flight)
  //  - no candidate is already selected (manual or auto)
  //  - the user hasn't manually selected/switched/cleared a candidate
  //    during this search cycle
  //  - this exact cycle hasn't already been auto-selected (rerender guard)
  //  - player AND card number evidence are both present -- re-checked here
  //    directly rather than trusted from the recommendation alone, so
  //    malformed upstream data can never cause an auto-select without
  //    genuine identity evidence
  // This never creates a catalog row, never saves, never mutates
  // persistence -- it only calls the same applyCandidateSelection() a
  // manual pick uses.
  useEffect(() => {
    const eligible = shouldAutoSelectCandidate({
      isWishlistCard,
      hasSelectedCandidate: selectedCandidate !== null,
      hasManualInteraction: hasManualCandidateInteractionRef.current,
      alreadyAutoSelectedThisCycle: autoSelectedCandidateCycleKeyRef.current === searchCycleKey,
      candidatesResolvedForCurrentCycle: resolvedCandidateCycleKey === searchCycleKey,
      topAssessment: confidenceAssessments[0],
    });
    if (!eligible) return;

    autoSelectedCandidateCycleKeyRef.current = searchCycleKey;
    applyCandidateSelection(confidenceAssessments[0].candidate);
    setCandidateAutoSelected(true);
  }, [isWishlistCard, selectedCandidate, resolvedCandidateCycleKey, searchCycleKey, confidenceAssessments]);

  useEffect(() => {
    if (!isWishlistCard) return;
    setLocation("");
    setPurchasePrice("");
    setPurchaseDate("");
    frontImage.setImageUrl(null);
    frontImage.setImageOwnerConfirm(false);
    frontImage.setImageShare(false);
    frontImage.setCardPhotoConfirm(false);
    backImage.setImageUrl(null);
    backImage.setImageOwnerConfirm(false);
    backImage.setImageShare(false);
    backImage.setCardPhotoConfirm(false);
  }, [isWishlistCard]);

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
      backOcrPending);

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
    // failure a genuine second chance on retry. A genuine failure (runOcr
    // throws, or the update itself fails) DOES set anyFailed now -- per the
    // corrected contract, an OCR failure blocks navigation/reset the same
    // way a media failure does, so the user can retry it, and leaves the
    // row at "cropped" (the OCR-persist call is simply never made).
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
        anyFailed = true;
        setFrontOcrStatus("failed");
        setFrontOcrError(
          "Card saved, but front text recognition failed. Press Save again to retry.",
        );
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
    // exactly, independently.
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
        anyFailed = true;
        setBackOcrStatus("failed");
        setBackOcrError(
          "Card saved, but back text recognition failed. Press Save again to retry.",
        );
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
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
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
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
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
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
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
            <p className="mt-1 text-xs text-zinc-900">
              Catalog v2 preview: picking a section doesn&apos;t change what gets saved yet.
            </p>
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
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
              />
              {showCatalogCardResults && catalogCardOptions.length ? (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                  {catalogCardOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedCard(c);
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
            <p className="mt-1 text-xs text-zinc-900">
              Catalog v2 preview: picking a card doesn&apos;t change what gets saved yet.
            </p>
          </div>
        ) : null}

        {selectedCard ? (
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
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
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
                          setParallel(v.parallelName ?? "");
                          setIsAutograph(v.hasAutograph);
                          setIsPatch(v.hasMemorabilia);
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
                imageUrl={frontImage.imageUrl}
                setImageUrl={frontImage.setImageUrl}
                imageType={frontImage.imageType}
                setImageType={frontImage.setImageType}
                setImageIsFront={frontImage.setImageIsFront}
                setImageIsSlabbed={frontImage.setImageIsSlabbed}
                cardPhotoConfirm={frontImage.cardPhotoConfirm}
                setCardPhotoConfirm={frontImage.setCardPhotoConfirm}
                imageOwnerConfirm={frontImage.imageOwnerConfirm}
                setImageOwnerConfirm={frontImage.setImageOwnerConfirm}
                imageShare={frontImage.imageShare}
                setImageShare={frontImage.setImageShare}
                imageError={frontImage.imageError}
                imageCheckStatus={frontImage.imageCheckStatus}
                sharedImage={sharedImage}
                reportInfo={reportInfo}
                fingerprint={fingerprint}
                onFileSelected={frontImage.handleImageFile}
              />
              {ocrStatusLabel("front", frontOcrStatus, frontOcrResult) ? (
                <div className="mt-1 text-xs text-zinc-500">
                  {ocrStatusLabel("front", frontOcrStatus, frontOcrResult)}
                </div>
              ) : null}
              {frontOcrError ? (
                <div className="mt-1 text-xs text-red-600">{frontOcrError}</div>
              ) : null}
            </div>

            {/* Back Image: independent slot. No community-image lookup
                exists for a back photo yet, since the shared-image feature
                is keyed by a single card-identity fingerprint today. */}
            <div>
              <CardImageUploader
                label="Back Image"
                imageUrl={backImage.imageUrl}
                setImageUrl={backImage.setImageUrl}
                imageType={backImage.imageType}
                setImageType={backImage.setImageType}
                setImageIsFront={backImage.setImageIsFront}
                setImageIsSlabbed={backImage.setImageIsSlabbed}
                cardPhotoConfirm={backImage.cardPhotoConfirm}
                setCardPhotoConfirm={backImage.setCardPhotoConfirm}
                imageOwnerConfirm={backImage.imageOwnerConfirm}
                setImageOwnerConfirm={backImage.setImageOwnerConfirm}
                imageShare={backImage.imageShare}
                setImageShare={backImage.setImageShare}
                imageError={backImage.imageError}
                imageCheckStatus={backImage.imageCheckStatus}
                sharedImage={null}
                reportInfo={null}
                fingerprint=""
                onFileSelected={backImage.handleImageFile}
              />
              {ocrStatusLabel("back", backOcrStatus, backOcrResult) ? (
                <div className="mt-1 text-xs text-zinc-500">
                  {ocrStatusLabel("back", backOcrStatus, backOcrResult)}
                </div>
              ) : null}
              {backOcrError ? (
                <div className="mt-1 text-xs text-red-600">{backOcrError}</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isWishlistCard && (mergedOcr.frontAvailable || mergedOcr.backAvailable) ? (
          <div className="sm:col-span-2 text-xs text-zinc-500">
            Combined OCR ready
            {mergedOcr.conflictCount > 0
              ? ` • ${mergedOcr.conflictCount} field conflict${mergedOcr.conflictCount === 1 ? "" : "s"}`
              : ""}
          </div>
        ) : null}

        {/* Vision Engine V2, Phase 7A/7B/7C: candidate summary plus
            confidence/explainability, with a manual select/clear control
            and (Phase 7C) automatic preselection for a "safe_to_preselect"
            top candidate. Ranking score and confidence are shown as two
            distinct numbers on purpose (confidence is not a rescale of
            score). Selecting -- manually or automatically -- only fills
            player/year/set/cardNumber/parallel; it never saves, never
            touches catalogQuery, and never creates/mutates a catalog row. */}
        {!isWishlistCard && candidateResults.length > 0 && topConfidenceAssessment ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Top Candidate</div>
            <div className="mt-1">
              {[candidateResults[0].setName, candidateResults[0].year].filter(Boolean).join(" ")}
            </div>
            <div>
              {candidateResults[0].playerName ?? candidateResults[0].cardTitle}
              {candidateResults[0].cardNumber ? ` #${candidateResults[0].cardNumber}` : ""}
            </div>
            <div className="mt-1 text-zinc-500">
              Ranking score: {candidateResults[0].score.toFixed(1)} • Confidence:{" "}
              {topConfidenceAssessment.confidence.toFixed(1)}%
            </div>
            <div className="mt-1 font-medium text-zinc-700">
              {RECOMMENDATION_LABELS[topConfidenceAssessment.recommendation]}
            </div>
            <div className="mt-1 text-zinc-500">
              {topConfidenceAssessment.fieldAssessments
                .filter((f) => IMPORTANT_CONFIDENCE_FIELDS.has(f.field))
                .map((f) => `${CONFIDENCE_FIELD_LABELS[f.field] ?? f.field}: ${f.quality}`)
                .join(" / ")}
            </div>
            <div className="mt-2 text-zinc-500">
              Top {candidateResults.length} candidate{candidateResults.length === 1 ? "" : "s"} found
            </div>
            {selectedCandidate && selectedCandidate.cardId === candidateResults[0].cardId && candidateAutoSelected ? (
              <div className="mt-2 text-emerald-700">
                High-confidence catalog match selected automatically ({topConfidenceAssessment.confidence.toFixed(0)}%).
              </div>
            ) : null}
            <div className="mt-2">
              {selectedCandidate && selectedCandidate.cardId === candidateResults[0].cardId ? (
                <button
                  type="button"
                  onClick={clearSelectedCandidate}
                  className="text-zinc-600 underline"
                >
                  Clear selection
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => selectCandidateManually(candidateResults[0])}
                  className="text-blue-700 underline"
                >
                  Use this candidate
                </button>
              )}
            </div>
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
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
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
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            rows={3}
            placeholder="Any extra details…"
          />
        </div>

        <div className="sm:col-span-2 flex justify-end gap-2">
          <Link
            href={isWishlist ? "/cards/wishlist" : "/cards"}
            className="btn-secondary"
          >
            Cancel
          </Link>
          <button
            onClick={onSaveAndAddAnother}
            disabled={!canSave || isSaving}
            className="btn-secondary"
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
            className="btn-primary"
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
