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
  deleteCardMediaBySide,
} from "@/lib/repositories/cardMedia";
import {
  uploadCardMediaImage,
  removeCardMediaImage,
  getCardMediaImageUrl,
} from "@/lib/db/cardMediaStorage";

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
  const [backImageReplaced, setBackImageReplaced] = useState(false);
  const [backMediaPath, setBackMediaPath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

      setImageUrl(frontSignedUrl ?? loadImageForCard(String(found.id)) ?? null);
      setImageRemoved(false);
      setImageReplaced(false);

      setBackImageUrl(backSignedUrl);
      setBackImageRemoved(false);
      setBackImageReplaced(false);

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

      // Upload/persist or remove each side's private Storage object +
      // card_media row independently. imageReplaced/backImageReplaced (not
      // just imageUrl/backImageUrl being truthy) gate whether anything is
      // touched at all, so an unchanged image is never re-uploaded and
      // Storage is never overwritten unnecessarily. Removal preserves the
      // stored path (frontMediaPath/backMediaPath, captured at load time)
      // before touching anything, deletes the Storage object first, and
      // only deletes the card_media row once that succeeds (or the object
      // was already absent) -- so metadata never falsely claims media is
      // gone while an object might still exist, and an orphaned object is
      // never mistaken for a successful removal. Front and back run in
      // separate try/catches so one side's failure is distinguishable from
      // the other's and neither is silently swallowed -- both are surfaced
      // via the page's existing error-display state, and the card itself
      // (already saved above) is never discarded because of a media
      // failure.
      let frontMediaError: string | null = null;
      let backMediaError: string | null = null;

      try {
        if (imageRemoved) {
          if (frontMediaPath) {
            await removeCardMediaImage({ profileId, userCardId: original.id, side: "front" });
            await deleteCardMediaBySide(original.id, "front");
          }
        } else if (imageReplaced && imageUrl) {
          const { path } = await uploadCardMediaImage({
            profileId,
            userCardId: original.id,
            side: "front",
            dataUrl: imageUrl,
          });
          await upsertCardMediaBySide({
            userCardId: original.id,
            side: "front",
            originalPath: null,
            processedPath: path,
            processingStatus: "cropped",
          });
        }
      } catch {
        frontMediaError = "Card saved, but the front image could not be synchronized.";
      }

      try {
        if (backImageRemoved) {
          if (backMediaPath) {
            await removeCardMediaImage({ profileId, userCardId: original.id, side: "back" });
            await deleteCardMediaBySide(original.id, "back");
          }
        } else if (backImageReplaced && backImageUrl) {
          const { path } = await uploadCardMediaImage({
            profileId,
            userCardId: original.id,
            side: "back",
            dataUrl: backImageUrl,
          });
          await upsertCardMediaBySide({
            userCardId: original.id,
            side: "back",
            originalPath: null,
            processedPath: path,
            processingStatus: "cropped",
          });
        }
      } catch {
        backMediaError = "Card saved, but the back image could not be synchronized.";
      }

      setImageError(frontMediaError ?? "");
      setBackImageError(backMediaError ?? "");

      // Only navigate away when private media synced cleanly -- otherwise
      // the user would never see the error set above (this page unmounts
      // on navigation). The card itself is already saved either way.
      if (!frontMediaError && !backMediaError) {
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
                  }}
                  className="btn-secondary text-xs"
                >
                  Remove image
                </button>
              ) : null}
              {imageError ? <div className="text-xs text-red-600">{imageError}</div> : null}
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
                      setBackImageReplaced(true);
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
                    setBackImageReplaced(false);
                  }}
                  className="btn-secondary text-xs"
                >
                  Remove back image
                </button>
              ) : null}
              {backImageError ? <div className="text-xs text-red-600">{backImageError}</div> : null}
              <div className="text-[11px] text-zinc-500">
                Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB
              </div>
            </div>
          </div>
        </div>

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
