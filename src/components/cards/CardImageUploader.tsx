"use client";

import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";

export type CardImageUploaderProps = {
  label?: string;
  // Radio-group identity only -- this component is rendered once per image
  // slot (front/back), each with its own independent imageType state, but
  // HTML radio grouping is name-scoped across the whole DOM, not per
  // component instance. Without a per-instance name, both instances' radio
  // inputs shared the literal name="imageType" and were treated as ONE
  // native radio group, so selecting an option on one instance could
  // visibly un-select the other's. `side` (already returned by
  // useCardImageSlot, e.g. frontImage.side/backImage.side) makes the
  // group name unique per instance without inventing new identity state.
  side: "front" | "back";
  imageUrl: string | null;
  setImageUrl: (v: string | null) => void;
  imageType: "front" | "back" | "slab_front" | "slab_back";
  setImageType: (v: "front" | "back" | "slab_front" | "slab_back") => void;
  setImageIsFront: (v: boolean) => void;
  setImageIsSlabbed: (v: boolean) => void;
  cardPhotoConfirm: boolean;
  setCardPhotoConfirm: (v: boolean) => void;
  // Add Card presentation cleanup: the per-side "Community reference"
  // checkboxes (ownership + share consent) were consolidated into one
  // cohesive section at the bottom of the Add Card page (see cards/new/
  // page.tsx) rather than repeated under each of the Front/Back uploaders.
  // The setters are still needed here -- "Use community image" and "Remove
  // image" below reset both values back to false, exactly as before -- but
  // the current boolean values are no longer read/rendered by this
  // component, so only the setters remain in its contract.
  setImageOwnerConfirm: (v: boolean) => void;
  setImageShare: (v: boolean) => void;
  imageError: string;
  imageCheckStatus: "idle" | "checking" | "accept" | "review" | "block";
  sharedImage: {
    fingerprint: string;
    dataUrl: string;
    isFront: boolean;
    isSlabbed: boolean;
    createdAt: string;
  } | null;
  reportInfo: { reports: number; status?: string } | null;
  fingerprint: string;
  onFileSelected: (file: File | null) => void;
};

export function CardImageUploader({
  label,
  side,
  imageUrl,
  setImageUrl,
  imageType,
  setImageType,
  setImageIsFront,
  setImageIsSlabbed,
  cardPhotoConfirm,
  setCardPhotoConfirm,
  setImageOwnerConfirm,
  setImageShare,
  imageError,
  imageCheckStatus,
  sharedImage,
  reportInfo,
  // Add Card scan UX simplification: the debug "Fingerprint: <value>" line
  // this component used to render for the front slot was removed -- it
  // exposed useSharedImageLookup's internal community-image lookup key to
  // collectors with no explanation or action attached to it. The prop
  // itself, and the underlying fingerprint/community-image mechanism in
  // the parent (useSharedImageLookup, buildCardFingerprint, sharedImage/
  // reportInfo above), are unchanged -- only this one rendering was
  // deleted, so the prop is left in place (still passed by both callers in
  // cards/new/page.tsx) rather than reworking the component's contract.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fingerprint,
  onFileSelected,
}: CardImageUploaderProps) {
  // Add Card mobile UX, Compact Photos phase: hideCommunity/previewSrc were
  // pulled out of the old inline IIFE (unchanged formula) so both the
  // preview box AND the layout-size decision below can read them, instead
  // of only the box's own render branch. previewSrc is exactly the old
  // `display` value (imageUrl, or a non-hidden shared-image dataUrl) --
  // whenever there's nothing real to preview, the uploader renders the new
  // compact empty state instead of a full card-aspect-ratio box; the
  // moment there's something to show, it renders the exact same
  // aspect-[2.5/3.5] preview layout this component already had. This
  // component has exactly one caller (cards/new/page.tsx, front + back),
  // so this default-behavior change needs no new prop to stay scoped.
  const hideCommunity =
    reportInfo && (reportInfo.status === "blocked" || reportInfo.reports >= REPORT_HIDE_THRESHOLD);
  const previewSrc = imageUrl || (!hideCommunity ? sharedImage?.dataUrl : undefined);
  // "An image exists" for the purposes of side/slab classification and the
  // photo-confirmation checkbox means the user's OWN selected image
  // (imageUrl), not merely a community-reference suggestion being
  // previewed for consideration -- classifying/confirming a photo that
  // isn't actually theirs yet wouldn't mean anything. cardPhotoConfirm's
  // role in canSave (cards/new/page.tsx) is completely unchanged by this --
  // only where this checkbox is allowed to render changed.
  const hasOwnImage = !!imageUrl;
  const sideWord = side === "front" ? "front" : "back";
  const uploadLabel = hasOwnImage ? "Retake photo" : `Add ${sideWord} photo`;

  return (
    <div className="sm:col-span-2">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-medium text-zinc-900">{label ?? "Card image"}</div>
        {side === "back" ? <div className="text-xs text-zinc-500">Optional</div> : null}
      </div>

      <div
        className={
          previewSrc
            ? "mt-2 grid gap-3 sm:grid-cols-[140px_1fr]"
            : "mt-2 flex flex-wrap items-center gap-2"
        }
      >
        <div
          className={
            previewSrc
              ? "relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden"
              : "relative h-12 w-12 flex-none rounded-md border border-dashed border-zinc-300 bg-zinc-50 overflow-hidden"
          }
        >
          {previewSrc ? (
            // previewSrc is either imageUrl (a signed Supabase Storage URL
            // or local data URL) or a community-shared image's data URL;
            // next/image is intentionally not used here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="Card" className="h-full w-full object-contain" />
          ) : hideCommunity ? (
            <div className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-500 text-center px-1">
              Hidden
            </div>
          ) : null}
          {previewSrc ? (
            <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300/70" />
          ) : null}
        </div>

        {/* Button-system Phase 3: these three compact media controls
            (Upload/Use community image/Remove image) are optional/
            utility actions -- none of them save or commit anything, they
            only change what's staged in this form -- so .btn-secondary,
            kept at their existing compact text-xs size rather than full
            px-4/py-2 geometry (per the task's guidance for small media
            controls). Upload/remove/community-image behavior unchanged. */}
        <div className={previewSrc ? "min-w-0 space-y-2" : "min-w-0 flex-1 space-y-2"}>
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary text-xs cursor-pointer">
              {uploadLabel}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
            </label>

            {sharedImage?.dataUrl && !imageUrl && !hideCommunity ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(sharedImage.dataUrl);
                  setImageOwnerConfirm(false);
                  setImageShare(false);
                }}
                className="btn-secondary text-xs"
              >
                Use community image
              </button>
            ) : null}

            {imageUrl ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(null);
                  setImageOwnerConfirm(false);
                  setImageShare(false);
                }}
                className="btn-secondary text-xs"
              >
                Remove image
              </button>
            ) : null}
          </div>

          {/* Add Card mobile UX, Compact Photos phase: side/slab
              classification and the photo-confirmation checkbox now only
              render once the user has an actual image of their own
              (hasOwnImage) -- there is nothing to classify or confirm
              before that, and showing them in the empty state was exactly
              the "several technical-looking controls before they're
              useful" problem this phase targets. Defaults
              (imageType="front"/imageIsFront=true/imageIsSlabbed=false,
              see useCardImageSlot.ts) are completely unchanged -- a user
              who never touches these still gets the exact same values at
              save time as before; this only changes when the controls are
              visible, never what they default to or how they behave. */}
          {hasOwnImage ? (
            <>
              <div className="grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`imageType-${side}`}
                    value="front"
                    checked={imageType === "front"}
                    onChange={() => {
                      setImageType("front");
                      setImageIsFront(true);
                      setImageIsSlabbed(false);
                    }}
                  />
                  Front of card
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`imageType-${side}`}
                    value="back"
                    checked={imageType === "back"}
                    onChange={() => {
                      setImageType("back");
                      setImageIsFront(false);
                      setImageIsSlabbed(false);
                    }}
                  />
                  Back of card
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`imageType-${side}`}
                    value="slab_front"
                    checked={imageType === "slab_front"}
                    onChange={() => {
                      setImageType("slab_front");
                      setImageIsFront(true);
                      setImageIsSlabbed(true);
                    }}
                  />
                  Slab front
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`imageType-${side}`}
                    value="slab_back"
                    checked={imageType === "slab_back"}
                    onChange={() => {
                      setImageType("slab_back");
                      setImageIsFront(false);
                      setImageIsSlabbed(true);
                    }}
                  />
                  Slab back
                </label>
              </div>

              <label className="inline-flex items-start gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={cardPhotoConfirm}
                  onChange={(e) => setCardPhotoConfirm(e.target.checked)}
                  className="mt-0.5"
                />
                I confirm this is a photo of the card (or slab).
              </label>
            </>
          ) : null}

          {imageError ? (
            <div className="text-xs text-red-600">{imageError}</div>
          ) : null}

          {imageCheckStatus === "checking" ? (
            <div className="text-xs text-zinc-500">Checking image…</div>
          ) : null}
          {imageCheckStatus === "review" ? (
            <div className="text-xs text-amber-600">
              Please confirm this is a clear photo of the card.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
