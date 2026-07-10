"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GradingStatus, CardStatus } from "@/lib/types";
import { type MyCard, type MyCardInput, getMyCard, updateMyCard } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { loadImageForCard, removeImageForCard, saveImageForCard, saveThumbnailForCard } from "@/lib/imageStore";
import { IMAGE_RULES, processImageFile } from "@/lib/image";
import { formatCurrency } from "@/lib/format";
import {
  getCardMediaBySide,
  upsertCardMediaBySide,
  updateCardMedia,
  deleteCardMediaBySide,
  type JsonValue,
} from "@/lib/repositories/cardMedia";
import {
  uploadCardMediaImage,
  removeCardMediaImage,
  getCardMediaImageUrl,
} from "@/lib/db/cardMediaStorage";
import { runOcr, type CardOcrResult } from "@/lib/ocr";
import { mergeCardOcrResults } from "@/lib/ocr/merge";

// Vision Engine V2, Phase 6A: defensive shape check before trusting a
// loaded card_media.ocr_output value as a real CardOcrResult -- it was
// written by this app's own OCR persistence step, but re-validating avoids
// blindly trusting arbitrary stored JSON (e.g. from a future schema change).
function isCardOcrResult(value: unknown, side: "front" | "back"): value is CardOcrResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.side === side &&
    typeof v.rawText === "string" &&
    Array.isArray(v.lines) &&
    typeof v.extracted === "object" &&
    v.extracted !== null
  );
}

// Vision Engine V2, Phase 6A correction: minimal, side-specific OCR status
// text -- never exposes raw model JSON/extracted fields. "done" always
// means a genuinely successful, completed OCR attempt -- it may have
// found no text (a valid, neutral outcome), which is distinct from
// "failed" (the request/response itself was invalid).
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

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

function toNum(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;

  // allow commas/spaces people sometimes type
  const cleaned = t.replace(/,/g, "").replace(/\s/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export default function EditCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [original, setOriginal] = useState<MyCard | null>(null);

  // Core
  const [playerName, setPlayerName] = useState("");
  const [year, setYear] = useState("");
  const [setName, setSetName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [team, setTeam] = useState("");

  // Location
  const [location, setLocation] = useState("");

  // Condition / grading
  const [gradingStatus, setGradingStatus] = useState<GradingStatus>("RAW");
  const [grader, setGrader] = useState("");
  const [grade, setGrade] = useState("");

  // Status / purchase
  const [status, setStatus] = useState<CardStatus>("HAVE");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [marketValue, setMarketValue] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState<string>("");

  // Collector fields
  const [variation, setVariation] = useState("");
  const [insert, setInsert] = useState("");
  const [parallel, setParallel] = useState("");
  const [serialNumber, setSerialNumber] = useState<string>("");
  const [serialTotal, setSerialTotal] = useState<string>("");

  const [isRookie, setIsRookie] = useState(false);
  const [isAutograph, setIsAutograph] = useState(false);
  const [isPatch, setIsPatch] = useState(false);

  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [imageRemoved, setImageRemoved] = useState(false);
  // Vision Engine V2, Phase 5B: imageUrl may now be a *signed display URL*
  // resolved from card_media (see the load effect), not just a local data
  // URL -- imageReplaced distinguishes "the user picked a genuinely new
  // file this session" from "this is just the loaded/displayed value,
  // unchanged," so save logic never re-uploads an unchanged signed URL or
  // writes one into legacy localStorage. frontMediaPath is the actual
  // stored card_media object path (independent of whatever could or
  // couldn't be resolved to a signed URL for display), so save/remove
  // logic always knows whether a card_media row already exists.
  const [imageReplaced, setImageReplaced] = useState(false);
  const [frontMediaPath, setFrontMediaPath] = useState<string | null>(null);
  // Back image is card_media-only -- there is no legacy column/localStorage
  // equivalent for it, so it has no "removed vs. never had one" ambiguity
  // the way the front slot does.
  const [backImageUrl, setBackImageUrl] = useState<string | null>(null);
  const [backImageError, setBackImageError] = useState("");
  const [backImageRemoved, setBackImageRemoved] = useState(false);
  const [backMediaPath, setBackMediaPath] = useState<string | null>(null);
  // Vision Engine V2, Phase 6A final correction: media synchronization and
  // OCR synchronization are tracked as independent pending flags per side,
  // so a replaced image's media upload/upsert is never repeated merely
  // because that side's OCR failed on a later retry. frontMediaRowId/
  // backMediaRowId retain the card_media row id (from a load, or from a
  // successful upload this session) so the OCR step always has a row to
  // attach its result to without needing to re-fetch it every retry.
  const [frontMediaPending, setFrontMediaPending] = useState(false);
  const [frontOcrPending, setFrontOcrPending] = useState(false);
  const [frontMediaRowId, setFrontMediaRowId] = useState<number | null>(null);
  const [backMediaPending, setBackMediaPending] = useState(false);
  const [backOcrPending, setBackOcrPending] = useState(false);
  const [backMediaRowId, setBackMediaRowId] = useState<number | null>(null);
  // Cached per-side OCR result. Populated from the loaded
  // card_media.ocr_output on load (preserved untouched for an unchanged
  // image, since an unchanged side never touches card_media on save at all
  // -- see onSave), or cleared and re-run when that side's image is
  // replaced. No automatic/background OCR ever runs against a legacy image
  // that has no card_media row, or against an unchanged image.
  const [frontOcrResult, setFrontOcrResult] = useState<CardOcrResult | null>(null);
  // "done" means a genuinely completed OCR attempt (which may have found no
  // text -- still a success); "failed" means the request/response itself
  // was invalid. A genuine failure blocks navigation (see onSave) so the
  // user can retry without re-uploading the image.
  const [frontOcrStatus, setFrontOcrStatus] = useState<"idle" | "running" | "done" | "failed">(
    "idle",
  );
  const [frontOcrError, setFrontOcrError] = useState("");
  const [backOcrResult, setBackOcrResult] = useState<CardOcrResult | null>(null);
  const [backOcrStatus, setBackOcrStatus] = useState<"idle" | "running" | "done" | "failed">(
    "idle",
  );
  const [backOcrError, setBackOcrError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Vision Engine V2, Phase 6B: pure, in-memory reconciliation of the two
  // independent side results, kept available for future use -- not
  // persisted (front/back card_media.ocr_output are untouched) and not
  // yet surfaced in this page's UI.
  const mergedOcr = useMemo(
    () => mergeCardOcrResults(frontOcrResult, backOcrResult),
    [frontOcrResult, backOcrResult],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const found = await getMyCard(String(id));
      if (!active) return;

      if (!found) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setOriginal(found);

      setPlayerName(found.playerName ?? "");
      setYear(found.year ?? "");
      setSetName(found.setName ?? "");
      setCardNumber(found.cardNumber ?? "");
      setTeam(found.team ?? "");

      setLocation(found.location ?? "");

      setGradingStatus(found.gradingStatus ?? "RAW");
      setGrader(found.grader ?? "");
      setGrade(found.grade ?? "");

      setStatus(found.status ?? "HAVE");
      setPurchasePrice(typeof found.purchasePrice === "number" ? String(found.purchasePrice) : "");
      setMarketValue(typeof found.estimatedValue === "number" ? String(found.estimatedValue) : "");
      setPurchaseDate(found.purchaseDate ?? "");

      setVariation(found.variation ?? "");
      setInsert(found.insert ?? "");
      setParallel(found.parallel ?? "");

      setSerialNumber(typeof found.serialNumber === "number" ? String(found.serialNumber) : "");
      setSerialTotal(typeof found.serialTotal === "number" ? String(found.serialTotal) : "");

      setIsRookie(!!found.isRookie);
      setIsAutograph(!!found.isAutograph);
      setIsPatch(!!found.isPatch);

      setNotes(found.notes ?? "");

      // Vision Engine V2, Phase 5B: prefer card_media -- resolved through a
      // temporary signed Storage URL, since the bucket is private -- when
      // present, falling back to the legacy localStorage image for cards
      // saved before this migration existed, or if the stored object path
      // can't be resolved to a usable URL right now. The back slot has no
      // legacy fallback -- it's simply absent for any card that predates
      // card_media, or if its resolution fails.
      let frontMedia: Awaited<ReturnType<typeof getCardMediaBySide>> = null;
      let backMedia: Awaited<ReturnType<typeof getCardMediaBySide>> = null;
      try {
        [frontMedia, backMedia] = await Promise.all([
          getCardMediaBySide(found.id, "front"),
          getCardMediaBySide(found.id, "back"),
        ]);
      } catch {
        // If card_media is unreachable, fall through to the legacy-only
        // load below exactly as this page behaved before this task.
      }
      if (!active) return;

      const frontStoredPath = frontMedia?.processedPath ?? frontMedia?.originalPath ?? null;
      const backStoredPath = backMedia?.processedPath ?? backMedia?.originalPath ?? null;

      const frontSignedUrl = frontStoredPath ? await getCardMediaImageUrl(frontStoredPath) : null;
      if (!active) return;
      const backSignedUrl = backStoredPath ? await getCardMediaImageUrl(backStoredPath) : null;
      if (!active) return;

      // The stored path (not the signed display URL) is what save/remove
      // logic keys off of, kept separate so "couldn't render a preview
      // right now" is never confused with "there is no stored media for
      // this side."
      setFrontMediaPath(frontStoredPath);
      setBackMediaPath(backStoredPath);

      // Vision Engine V2, Phase 6A final correction: retain each side's
      // existing card_media row id (if any) so a later OCR-only retry can
      // update it directly without re-uploading or re-fetching it. Nothing
      // is pending on load -- pending only becomes true once the user
      // actively replaces that side's image.
      setFrontMediaRowId(frontMedia?.id ?? null);
      setFrontMediaPending(false);
      setFrontOcrPending(false);
      setBackMediaRowId(backMedia?.id ?? null);
      setBackMediaPending(false);
      setBackOcrPending(false);

      setImageUrl(frontSignedUrl ?? loadImageForCard(String(found.id)) ?? null);
      setImageRemoved(false);
      setImageReplaced(false);

      setBackImageUrl(backSignedUrl);
      setBackImageRemoved(false);

      // Load each side's existing OCR result as-is, with no automatic OCR
      // run for a legacy card that has no card_media row (frontMedia/
      // backMedia null) -- OCR only ever runs in response to the user
      // actively replacing that side's image (see onSave).
      setFrontOcrResult(
        isCardOcrResult(frontMedia?.ocrOutput, "front")
          ? (frontMedia!.ocrOutput as unknown as CardOcrResult)
          : null,
      );
      setFrontOcrStatus("idle");
      setFrontOcrError("");
      setBackOcrResult(
        isCardOcrResult(backMedia?.ocrOutput, "back")
          ? (backMedia!.ocrOutput as unknown as CardOcrResult)
          : null,
      );
      setBackOcrStatus("idle");
      setBackOcrError("");

      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const canSave = useMemo(() => {
    return Boolean(playerName.trim() && year.trim() && setName.trim());
  }, [playerName, year, setName]);

  // ✅ Currency preview for Paid input
  const paidPreview = useMemo(() => {
    const n = toNum(purchasePrice);
    if (typeof n !== "number") return null;
    return formatCurrency(n);
  }, [purchasePrice]);

  const marketPreview = useMemo(() => {
    const n = toNum(marketValue);
    if (typeof n !== "number") return null;
    return formatCurrency(n);
  }, [marketValue]);

  async function onSave() {
    if (!original) return;
    if (!canSave) return;
    setIsSaving(true);
    try {
      const derivedSerialTotal =
        serialTotal.trim() ||
        (parallel.match(/\/\s*(\d+)\b/) ? parallel.match(/\/\s*(\d+)\b/)?.[1] ?? "" : "");

      const patch: Partial<MyCardInput> = {
        playerName: playerName.trim(),
        year: year.trim(),
        setName: setName.trim(),
        cardNumber: cardNumber.trim() || undefined,
        team: team.trim() || undefined,

        location: location.trim() || undefined,

        gradingStatus,
        grader: gradingStatus === "GRADED" ? (grader.trim() || undefined) : undefined,
        grade: gradingStatus === "GRADED" ? (grade.trim() || undefined) : undefined,

        status,

        purchasePrice: toNum(purchasePrice),
        estimatedValue: toNum(marketValue),
        purchaseDate: purchaseDate || undefined,

        variation: variation.trim() || undefined,
        insert: insert.trim() || undefined,
        parallel: parallel.trim() || undefined,
        serialNumber: toNum(serialNumber),
        serialTotal: toNum(derivedSerialTotal),

        isRookie: isRookie || undefined,
        isAutograph: isAutograph || undefined,
        isPatch: isPatch || undefined,

        notes: notes.trim() || undefined,
        imageShared: imageUrl && !imageRemoved ? original.imageShared : false,
      };

      if (imageRemoved) {
        removeImageForCard(String(original.id));
      }

      const profileId = await requireProfileId();
      await updateMyCard(profileId, original.id, patch);
      // Vision Engine V2, Phase 5B: only write to legacy localStorage when
      // the user picked a genuinely new local file this session
      // (imageReplaced) -- imageUrl may now be a *signed display URL*
      // resolved from an existing card_media row (see the load effect), and
      // writing that into legacy storage would corrupt it with a URL that
      // expires in an hour.
      if (imageReplaced && imageUrl) {
        saveImageForCard(String(original.id), imageUrl);
        await saveThumbnailForCard(String(original.id), imageUrl);
      }

      // Vision Engine V2, Phase 6A final correction: media synchronization
      // and OCR synchronization are tracked and retried independently per
      // side via frontMediaPending/frontOcrPending (and their back
      // equivalents), so a side whose media already succeeded is never
      // re-uploaded merely because that side's OCR failed on a later
      // retry -- the OCR step only ever reads/updates the retained
      // frontMediaRowId/backMediaRowId row. Removal preserves the stored
      // path (frontMediaPath/backMediaPath, captured at load time) before
      // touching anything, deletes the Storage object first, and only
      // deletes the card_media row once that succeeds (or the object was
      // already absent) -- so metadata never falsely claims media is gone
      // while an object might still exist, and an orphaned object is never
      // mistaken for a successful removal. Front and back run in separate
      // try/catches so one side's failure is distinguishable from the
      // other's and neither is silently swallowed -- both are surfaced via
      // the page's existing error-display state, and the card itself
      // (already saved above) is never discarded because of a media or OCR
      // failure.
      let frontMediaError: string | null = null;
      let backMediaError: string | null = null;
      let frontOcrFailed: string | null = null;
      let backOcrFailed: string | null = null;

      // ---- Front ----
      let frontRowId = frontMediaRowId;

      if (imageRemoved) {
        if (frontMediaPath) {
          try {
            await removeCardMediaImage({ profileId, userCardId: original.id, side: "front" });
            await deleteCardMediaBySide(original.id, "front");
          } catch {
            frontMediaError = "Card saved, but the front image could not be synchronized.";
          }
        }
      } else {
        if (frontMediaPending && imageUrl) {
          try {
            const { path } = await uploadCardMediaImage({
              profileId,
              userCardId: original.id,
              side: "front",
              dataUrl: imageUrl,
            });
            const media = await upsertCardMediaBySide({
              userCardId: original.id,
              side: "front",
              originalPath: null,
              processedPath: path,
              processingStatus: "cropped",
            });
            frontRowId = media.id;
            setFrontMediaRowId(frontRowId);
            setFrontMediaPending(false);
          } catch {
            frontMediaError = "Card saved, but the front image could not be synchronized.";
          }
        }

        // OCR only runs once media has a row to attach to -- either from
        // this same attempt (frontRowId just set above) or from an earlier
        // successful attempt (frontMediaPending already false, frontRowId
        // retained from state). If media itself just failed above,
        // frontMediaError is set and this is skipped entirely, so OCR is
        // never persisted without a genuine media row backing it.
        if (!frontMediaError && frontOcrPending && imageUrl && frontRowId) {
          try {
            let result = frontOcrResult;
            if (!result) {
              setFrontOcrStatus("running");
              result = await runOcr(imageUrl, "front");
              setFrontOcrResult(result);
            }
            await updateCardMedia(frontRowId, {
              ocrOutput: result as unknown as JsonValue,
              processingStatus: "ocr_complete",
            });
            setFrontOcrPending(false);
            setFrontOcrStatus("done");
            setFrontOcrError("");
          } catch {
            frontOcrFailed =
              "Card saved, but front text recognition failed. Press Save again to retry.";
            setFrontOcrStatus("failed");
          }
        }
      }

      // ---- Back ---- (mirrors front, independently)
      let backRowId = backMediaRowId;

      if (backImageRemoved) {
        if (backMediaPath) {
          try {
            await removeCardMediaImage({ profileId, userCardId: original.id, side: "back" });
            await deleteCardMediaBySide(original.id, "back");
          } catch {
            backMediaError = "Card saved, but the back image could not be synchronized.";
          }
        }
      } else {
        if (backMediaPending && backImageUrl) {
          try {
            const { path } = await uploadCardMediaImage({
              profileId,
              userCardId: original.id,
              side: "back",
              dataUrl: backImageUrl,
            });
            const media = await upsertCardMediaBySide({
              userCardId: original.id,
              side: "back",
              originalPath: null,
              processedPath: path,
              processingStatus: "cropped",
            });
            backRowId = media.id;
            setBackMediaRowId(backRowId);
            setBackMediaPending(false);
          } catch {
            backMediaError = "Card saved, but the back image could not be synchronized.";
          }
        }

        if (!backMediaError && backOcrPending && backImageUrl && backRowId) {
          try {
            let result = backOcrResult;
            if (!result) {
              setBackOcrStatus("running");
              result = await runOcr(backImageUrl, "back");
              setBackOcrResult(result);
            }
            await updateCardMedia(backRowId, {
              ocrOutput: result as unknown as JsonValue,
              processingStatus: "ocr_complete",
            });
            setBackOcrPending(false);
            setBackOcrStatus("done");
            setBackOcrError("");
          } catch {
            backOcrFailed =
              "Card saved, but back text recognition failed. Press Save again to retry.";
            setBackOcrStatus("failed");
          }
        }
      }

      setImageError(frontMediaError ?? "");
      setBackImageError(backMediaError ?? "");
      setFrontOcrError(frontOcrFailed ?? "");
      setBackOcrError(backOcrFailed ?? "");

      // Only navigate away once front AND back media AND OCR have all
      // either succeeded or had nothing to do -- otherwise the user would
      // never see the error set above (this page unmounts on navigation).
      // The card itself is already saved either way, and the retained row
      // ids/pending flags mean a retry never repeats already-successful
      // work.
      if (!frontMediaError && !backMediaError && !frontOcrFailed && !backOcrFailed) {
        router.push(`/cards/${original.id}`);
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (loading)
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 w-1/3 rounded bg-zinc-200/70" />
        <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`edit-skel-${i}`} className="h-10 rounded bg-zinc-200/70" />
          ))}
        </div>
      </div>
    );

  if (notFound) {
    return (
      <div className="error-state space-y-2">
        <div className="text-base font-semibold">Card not found</div>
        <div className="text-xs text-zinc-600">
          ID in URL: <span className="font-mono">{String(id)}</span>
        </div>
        <Link href="/cards" className="btn-link">
          Back to Binder
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit Card</h1>
          <p className="text-sm text-zinc-600">Update details for this card.</p>
        </div>
        <Link href={`/cards/${String(id)}`} className="btn-secondary">
          Back
        </Link>
      </div>

      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <Field label="Player" value={playerName} onChange={setPlayerName} placeholder="Baker Mayfield" />
        <Field label="Year" value={year} onChange={setYear} placeholder="2018" />
        <Field label="Set" value={setName} onChange={setSetName} placeholder="Panini Score" />
        <Field label="Card #" value={cardNumber} onChange={setCardNumber} placeholder="123" />
        <Field label="Team" value={team} onChange={setTeam} placeholder="Browns" />
        <Field label="Location" value={location} onChange={setLocation} placeholder="Binder A / Box 1 / Safe" />

        <Select
          label="Condition"
          value={gradingStatus}
          onChange={(v) => setGradingStatus(v as GradingStatus)}
          options={[
            ["RAW", "Raw"],
            ["GRADED", "Graded"],
          ]}
        />

        {/* ✅ No placeholders here (prevents weird empty grid gaps) */}
        {gradingStatus === "GRADED" ? (
          <>
            <Field label="Grader" value={grader} onChange={setGrader} placeholder="PSA" />
            <Field label="Grade" value={grade} onChange={setGrade} placeholder="10" />
          </>
        ) : null}

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

        {/* ✅ Paid is now a single grid item (no nested Field) */}
        <MoneyField
          label="Paid"
          value={purchasePrice}
          onChange={setPurchasePrice}
          placeholder="50"
          preview={paidPreview}
        />
        <MoneyField
          label="Market value"
          value={marketValue}
          onChange={setMarketValue}
          placeholder="65"
          preview={marketPreview}
        />

        <Field label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} type="date" />

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
          <label className="block text-xs font-medium text-zinc-600">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
            rows={3}
            placeholder="Any extra details…"
          />
        </div>

        <div className="sm:col-span-2 mt-2 border-t pt-4">
          <div className="text-sm font-medium text-zinc-900">Edit card image</div>
          <div className="text-xs text-zinc-500">
            This is the only place you can change the image for a card.
          </div>
        </div>

        <div className="sm:col-span-2 rounded-lg border bg-zinc-50/60 p-3">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr] items-start">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Front image
              </div>
              <div className="mt-2 h-44 w-full rounded-md border bg-white flex items-center justify-center overflow-hidden">
                {imageUrl ? (
                  <img src={imageUrl} alt="Card" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-xs text-zinc-400">No image</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
                <input
                  type="file"
                  accept={IMAGE_RULES.allowedTypes.join(",")}
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImageError("");
                    try {
                      const { dataUrl } = await processImageFile(file);
                      setImageUrl(dataUrl);
                      setImageRemoved(false);
                      setImageReplaced(true);
                      // Vision Engine V2, Phase 6A final correction:
                      // replacing marks both media and OCR pending for this
                      // side and clears its previous OCR result/error --
                      // the actual upload and OCR run happen in onSave, so
                      // media is never re-uploaded on a later OCR-only
                      // retry. Independent of back.
                      setFrontMediaPending(true);
                      setFrontOcrPending(true);
                      setFrontOcrResult(null);
                      setFrontOcrError("");
                      setFrontOcrStatus("idle");
                    } catch (err) {
                      setImageError((err as Error).message || "Image failed validation.");
                    }
                  }}
                />
                Change image
              </label>
              {imageUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setImageUrl(null);
                    setImageRemoved(true);
                    setImageReplaced(false);
                    setFrontMediaPending(false);
                    setFrontOcrPending(false);
                    setFrontMediaRowId(null);
                    setFrontOcrResult(null);
                    setFrontOcrStatus("idle");
                    setFrontOcrError("");
                  }}
                  className="btn-secondary text-xs"
                >
                  Remove image
                </button>
              ) : null}
              {imageError ? <div className="text-xs text-red-600">{imageError}</div> : null}
              {frontOcrError ? <div className="text-xs text-red-600">{frontOcrError}</div> : null}
              {ocrStatusLabel("front", frontOcrStatus, frontOcrResult) ? (
                <div className="text-[11px] text-zinc-500">
                  {ocrStatusLabel("front", frontOcrStatus, frontOcrResult)}
                </div>
              ) : null}
              <div className="text-[11px] text-zinc-500">
                Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB
              </div>
            </div>
          </div>
        </div>

        {/* Vision Engine V2, Phase 5: independent back-image slot. Mirrors
            the front section above exactly (same simple upload, no crop
            step -- consistent with how this page has always handled
            images), persisted separately into card_media only. */}
        <div className="sm:col-span-2 rounded-lg border bg-zinc-50/60 p-3">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr] items-start">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Back image
              </div>
              <div className="mt-2 h-44 w-full rounded-md border bg-white flex items-center justify-center overflow-hidden">
                {backImageUrl ? (
                  <img src={backImageUrl} alt="Card back" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-xs text-zinc-400">No image</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
                <input
                  type="file"
                  accept={IMAGE_RULES.allowedTypes.join(",")}
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBackImageError("");
                    try {
                      const { dataUrl } = await processImageFile(file);
                      setBackImageUrl(dataUrl);
                      setBackImageRemoved(false);
                      // Vision Engine V2, Phase 6A final correction:
                      // replacing marks both media and OCR pending for this
                      // side and clears its previous OCR result/error --
                      // the actual upload and OCR run happen in onSave, so
                      // media is never re-uploaded on a later OCR-only
                      // retry. Independent of front.
                      setBackMediaPending(true);
                      setBackOcrPending(true);
                      setBackOcrResult(null);
                      setBackOcrError("");
                      setBackOcrStatus("idle");
                    } catch (err) {
                      setBackImageError((err as Error).message || "Image failed validation.");
                    }
                  }}
                />
                Change back image
              </label>
              {backImageUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setBackImageUrl(null);
                    setBackImageRemoved(true);
                    setBackMediaPending(false);
                    setBackOcrPending(false);
                    setBackMediaRowId(null);
                    setBackOcrResult(null);
                    setBackOcrStatus("idle");
                    setBackOcrError("");
                  }}
                  className="btn-secondary text-xs"
                >
                  Remove back image
                </button>
              ) : null}
              {backImageError ? <div className="text-xs text-red-600">{backImageError}</div> : null}
              {backOcrError ? <div className="text-xs text-red-600">{backOcrError}</div> : null}
              {ocrStatusLabel("back", backOcrStatus, backOcrResult) ? (
                <div className="text-[11px] text-zinc-500">
                  {ocrStatusLabel("back", backOcrStatus, backOcrResult)}
                </div>
              ) : null}
              <div className="text-[11px] text-zinc-500">
                Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB
              </div>
            </div>
          </div>
        </div>

        {mergedOcr.frontAvailable || mergedOcr.backAvailable ? (
          <div className="sm:col-span-2 text-xs text-zinc-500">
            Combined OCR ready
            {mergedOcr.conflictCount > 0
              ? ` • ${mergedOcr.conflictCount} field conflict${mergedOcr.conflictCount === 1 ? "" : "s"}`
              : ""}
          </div>
        ) : null}

        <div className="sm:col-span-2 flex justify-end gap-2">
          <Link href={`/cards/${String(id)}`} className="btn-secondary">
            Cancel
          </Link>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="btn-primary"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- UI components ---------- */

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const isDate = type === "date";
  const [dateDisplay, setDateDisplay] = useState("");

  useEffect(() => {
    if (!isDate) return;
    if (!value) {
      setDateDisplay("");
      return;
    }
    const parts = value.split("-");
    if (parts.length === 3) {
      setDateDisplay(`${parts[1]}/${parts[2]}/${parts[0]}`);
      return;
    }
    setDateDisplay(value);
  }, [isDate, value]);

  function parseDateInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!match) return null;
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <div className={isDate ? "relative" : ""}>
        {isDate ? (
          <>
            <input
              value={dateDisplay}
              onChange={(e) => {
                const nextDisplay = e.target.value;
                setDateDisplay(nextDisplay);
                const parsed = parseDateInput(nextDisplay);
                if (parsed === "") onChange("");
                else if (parsed) onChange(parsed);
              }}
              placeholder="mm/dd/yyyy"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm pr-10"
            />
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              type="date"
              className="absolute inset-0 opacity-0"
              onClick={(e) => {
                const el = e.currentTarget;
                if (typeof (el as HTMLInputElement).showPicker === "function") {
                  (el as HTMLInputElement).showPicker();
                }
              }}
            />
          </>
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            type={type}
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
          />
        )}
        {isDate ? (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder,
  preview,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  preview: string | null;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
      />
      <div className="mt-1 text-xs text-zinc-500">{preview ? `Preview: ${preview}` : "Preview: —"}</div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
