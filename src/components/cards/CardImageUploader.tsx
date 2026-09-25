"use client";

import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";

export type CardImageUploaderProps = {
  label?: string;
  // Identifies which slot this instance is -- also still used to derive
  // this slot's canonical raw imageType/imageIsFront values below (see the
  // Slabbed checkbox and the Remove-image handler), now that side/back
  // identity is no longer user-selectable. `side` is always authoritative:
  // Front Image always means front, Back Image always means back.
  side: "front" | "back";
  imageUrl: string | null;
  setImageUrl: (v: string | null) => void;
  // Add Card Photos cleanup, classification phase: imageType is still
  // accepted (page.tsx still passes it -- the front slot's value still
  // feeds the legacy user_cards.image_type column) but is no longer read
  // for rendering here; only its setter is used, to keep it in sync
  // ("front"/"back"/"slab_front"/"slab_back") whenever the Slabbed
  // checkbox or Remove image changes imageIsSlabbed. imageIsSlabbed itself
  // is now read directly (previously only its setter was needed, since the
  // four radios derived their `checked` state from imageType instead).
  imageType: "front" | "back" | "slab_front" | "slab_back";
  setImageType: (v: "front" | "back" | "slab_front" | "slab_back") => void;
  setImageIsFront: (v: boolean) => void;
  imageIsSlabbed: boolean;
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
  // Add Card Photos cleanup, community-image trust phase: needed so
  // "Use community image" below can explicitly mark the selection as
  // verified (see that handler's own comment for the exact trust chain
  // this relies on) instead of leaving imageCheckStatus at whatever it
  // already was ("idle" on a fresh page) -- an implicit, easily-broken
  // "idle silently behaves like accept" is exactly what this phase closes.
  setImageCheckStatus: (v: "idle" | "checking" | "accept" | "review" | "block") => void;
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
  setImageType,
  setImageIsFront,
  imageIsSlabbed,
  setImageIsSlabbed,
  cardPhotoConfirm,
  setCardPhotoConfirm,
  setImageOwnerConfirm,
  setImageShare,
  imageError,
  imageCheckStatus,
  setImageCheckStatus,
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
  // Add Card mobile UX, Compact Photos phase: hideCommunity/previewSrc
  // (unchanged formula) decide what the card-shaped box actually displays.
  // previewSrc is exactly the old `display` value (imageUrl, or a
  // non-hidden shared-image dataUrl). This component has exactly one
  // caller (cards/new/page.tsx, front + back), so behavior changes here
  // need no new prop to stay scoped.
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
  const showSecondaryActions = (sharedImage?.dataUrl && !imageUrl && !hideCommunity) || !!imageUrl;
  // Add Card Photos cleanup, community-image trust phase: the ONE explicit
  // rule for when Front needs manual confirmation, kept in exact sync with
  // canSave's own logic in cards/new/page.tsx (which must never diverge
  // from this render condition -- see that file's own matching comment).
  // "checking" is excluded so the checkbox never appears prematurely, and
  // "accept" is excluded because that's the one status -- reached either
  // via a genuine image-check pass, or explicitly set by "Use community
  // image" below -- that means no further confirmation is owed. Every
  // OTHER real-image status (review, or any status this component doesn't
  // otherwise expect) requires confirmation; there is deliberately no
  // silent "else, trust it" branch.
  const showFrontConfirmation =
    side === "front" && hasOwnImage && imageCheckStatus !== "checking" && imageCheckStatus !== "accept";

  return (
    <div className="sm:col-span-2">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-medium text-zinc-900">{label ?? "Card image"}</div>
        {side === "back" ? <div className="text-xs text-zinc-500">Optional</div> : null}
      </div>

      {/* Add Card mobile UX, card-shaped preview phase: the preview is now
          the dominant element in each half-column -- w-full (never a fixed
          140px) so it scales with whatever width the outer two-column
          Photos grid (page.tsx, from 33b424a) actually gives this slot,
          same footprint whether empty or holding a real image (so
          selecting a photo doesn't jump the layout), and the same
          aspect-[2.5/3.5] Front and Back always share, so their sizes
          always match. The upload/retake action now renders BELOW this
          box instead of beside it -- see the button below. */}
      <div className="relative mt-2 w-full aspect-[2.5/3.5] rounded-md border bg-zinc-50 flex items-center justify-center overflow-hidden">
        {previewSrc ? (
          // previewSrc is either imageUrl (a signed Supabase Storage URL or
          // local data URL) or a community-shared image's data URL;
          // next/image is intentionally not used here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="Card" className="h-full w-full object-contain p-1" />
        ) : hideCommunity ? (
          <div className="px-2 text-center text-[11px] text-zinc-500">Image hidden (reported)</div>
        ) : (
          <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300" />
        )}
      </div>

      <div className="mt-2 space-y-2">
        {/* Button-system Phase 3: these three compact media controls
            (Upload/Use community image/Remove image) are optional/
            utility actions -- none of them save or commit anything, they
            only change what's staged in this form -- so .btn-secondary,
            kept at their existing compact text-xs size rather than full
            px-4/py-2 geometry (per the task's guidance for small media
            controls). Upload/remove/community-image behavior unchanged.
            The upload/retake action is now the visually primary control
            for this slot (w-full, directly under the preview it acts on)
            -- Use community image / Remove image are secondary, and wrap
            onto their own row if they don't fit the half-column beside
            each other. */}
        <label className="btn-secondary text-xs cursor-pointer w-full">
          {uploadLabel}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />
        </label>

        {showSecondaryActions ? (
          <div className="flex flex-wrap gap-2">
            {sharedImage?.dataUrl && !imageUrl && !hideCommunity ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(sharedImage.dataUrl);
                  setImageOwnerConfirm(false);
                  setImageShare(false);
                  // Add Card Photos cleanup, community-image trust phase:
                  // explicitly mark this as verified rather than leaving
                  // imageCheckStatus at whatever it already was (typically
                  // "idle" on a fresh page) -- a real Front image sitting
                  // at an untouched, non-terminal status must never be
                  // treated as accepted by accident. Trusting it here IS
                  // justified, not a loophole: this button is only ever
                  // offered at all when !hideCommunity (a reported/blocked
                  // community image never reaches this button, see above),
                  // and the image itself can only have entered the
                  // community pool via saveSharedImage in cards/new/
                  // page.tsx's runSaveCycle, which only ever runs after
                  // ITS OWN uploader's canSave was already satisfied --
                  // i.e. that original photo already passed either a
                  // genuine image-check "accept" or a manually confirmed
                  // "review" before it could ever become selectable here.
                  setImageCheckStatus("accept");
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
                  // Add Card Photos cleanup, classification phase: a
                  // removed image's slab classification must not silently
                  // carry over onto whatever photo is uploaded into this
                  // slot next -- reset to this slot's own raw defaults,
                  // mirroring useCardImageSlot.ts's confirmCrop/block-path
                  // resets for the exact same reason.
                  setImageType(side);
                  setImageIsFront(side === "front");
                  setImageIsSlabbed(false);
                }}
                className="btn-secondary text-xs"
              >
                Remove image
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Add Card Photos cleanup, classification phase: the previous
              four-option radio group (Front of card/Back of card/Slab
              front/Slab back) let a user classify Front Image's own photo
              as "back", or vice versa -- a choice nothing downstream ever
              honored (OCR/Vision/card_media.side are all driven
              exclusively by the `side` prop, hardcoded per call site in
              cards/new/page.tsx) and which produced exactly the
              production bug this phase fixes (a fresh Back Image slot
              showing "Front of card" selected, from
              useCardImageSlot.ts's old side-blind defaults). Side is no
              longer user-choosable at all -- Front Image always means
              front, Back Image always means back -- so the only
              genuinely independent, downstream-meaningful fact left to
              classify is whether THIS photo shows a slab. Toggling it
              re-derives imageType from (side, checked) so the legacy
              user_cards.image_type/shared_images fields this same state
              still feeds stay correct, but imageIsFront is always
              re-pinned to `side === "front"` -- it can never be flipped
              by this control, unlike before. */}
          {hasOwnImage ? (
            <>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={imageIsSlabbed}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setImageIsSlabbed(checked);
                    setImageType(checked ? (side === "front" ? "slab_front" : "slab_back") : side);
                    setImageIsFront(side === "front");
                  }}
                />
                Slabbed
              </label>

              {/* Add Card Photos cleanup, confirmation phase: previously
                  shown for every uploaded image regardless of
                  imageCheckStatus (including "accept", where image-check
                  had already classified it as "card" with >=0.75
                  confidence and moderation had already passed -- asking
                  the collector to re-verify what the system was already
                  confident about). Now shown only when showFrontConfirmation
                  is true (see its own comment above) -- kept in exact sync
                  with canSave's matching condition in cards/new/page.tsx,
                  so it is never possible for Save to require confirmation
                  with no visible control, or for a visible checkbox to have
                  no effect on Save. Front-only: canSave has never read
                  backImage.cardPhotoConfirm, so rendering an interactive
                  checkbox for Back that silently did nothing would be
                  misleading. Back still gets the exact same "Please
                  confirm..." guidance text below (unchanged, both sides),
                  just without a checkbox that implies it gates Save. */}
              {showFrontConfirmation ? (
                <label className="inline-flex items-start gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={cardPhotoConfirm}
                    onChange={(e) => setCardPhotoConfirm(e.target.checked)}
                    className="mt-0.5"
                  />
                  I confirm this is a card photo.
                </label>
              ) : null}
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
  );
}
