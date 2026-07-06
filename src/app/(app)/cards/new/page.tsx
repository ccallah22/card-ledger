"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { GradingStatus, CardStatus } from "@/lib/types";
import { type MyCardInput, createMyCard } from "@/lib/repositories/myCards";
import { listLocations } from "@/lib/repositories/locations";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { fetchSharedImage, saveSharedImage } from "@/lib/db/sharedImages";
import { cropImageDataUrl, processImageFile, rotateImageDataUrl } from "@/lib/image";
import { saveImageForCard, saveThumbnailForCard } from "@/lib/imageStore";
import type { ChecklistEntry } from "@/lib/db/checklists.client";
import {
  applySectionAutoFill,
  inferFlagsFromSection,
  toNum,
} from "@/lib/checklists/autofill";
import { Field, Select, Check } from "@/components/forms/FormControls";
import { useSetLookup } from "@/hooks/cards/useSetLookup";
import { useChecklistLookup } from "@/hooks/cards/useChecklistLookup";
import { CardImageUploader } from "@/components/cards/CardImageUploader";
import { CardImageCropModal } from "@/components/cards/CardImageCropModal";

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

function NewCardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWishlist = searchParams.get("wishlist") === "1";
  const isForSaleIntent = searchParams.get("forSale") === "1";

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageIsFront, setImageIsFront] = useState(true);
  const [imageIsSlabbed, setImageIsSlabbed] = useState(false);
  const [imageShare, setImageShare] = useState(false);
  const [imageOwnerConfirm, setImageOwnerConfirm] = useState(false);
  const [imageType, setImageType] = useState<
    "front" | "back" | "slab_front" | "slab_back"
  >("front");
  const [imageError, setImageError] = useState<string>("");
  const [imageCheckStatus, setImageCheckStatus] = useState<
    "idle" | "checking" | "accept" | "review" | "block"
  >("idle");
  const [cardPhotoConfirm, setCardPhotoConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reportInfo, setReportInfo] = useState<{ reports: number; status?: string } | null>(
    null
  );

  const [cropData, setCropData] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [cropSource, setCropSource] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotationBase, setCropRotationBase] = useState(0);
  const [cropRotationFine, setCropRotationFine] = useState(0);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const cropDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const CROP_FRAME_W = 320;
  const CROP_FRAME_H = 448;
  const CROP_FRAME_PAD = 8;
  const CROP_BOX_W = CROP_FRAME_W - CROP_FRAME_PAD * 2;
  const CROP_BOX_H = CROP_FRAME_H - CROP_FRAME_PAD * 2;
  const CROP_ZOOM_MIN = 1;
  const CROP_ZOOM_MAX = 1.5;
  const CROP_ROTATION_FINE_MIN = -10;
  const CROP_ROTATION_FINE_MAX = 10;

  const fingerprint = useMemo(
    () =>
      buildCardFingerprint({
        year,
        setName,
        cardNumber,
        playerName,
        team,
        insert,
        variation,
        parallel,
        serialTotal,
      }),
    [year, setName, cardNumber, playerName, team, insert, variation, parallel, serialTotal]
  );

  const [sharedImage, setSharedImage] = useState<null | {
    fingerprint: string;
    dataUrl: string;
    isFront: boolean;
    isSlabbed: boolean;
    createdAt: string;
  }>(null);

  useEffect(() => {
    let active = true;
    if (!fingerprint) {
      setSharedImage(null);
      return;
    }
    fetchSharedImage(fingerprint)
      .then((img) => {
        if (active) setSharedImage(img);
      })
      .catch(() => {
        if (active) setSharedImage(null);
      });
    return () => {
      active = false;
    };
  }, [fingerprint]);

  useEffect(() => {
    if (!fingerprint) {
      setReportInfo(null);
      return;
    }
    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints: [fingerprint] }),
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data?.[fingerprint];
        if (item) setReportInfo({ reports: item.reports ?? 0, status: item.status });
        else setReportInfo(null);
      })
      .catch(() => setReportInfo(null));
  }, [fingerprint]);

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

  useEffect(() => {
    if (!isWishlistCard) return;
    setLocation("");
    setPurchasePrice("");
    setPurchaseDate("");
    setImageUrl(null);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
  }, [isWishlistCard]);

  function clampCropOffset(
    next: { x: number; y: number },
    data: { width: number; height: number }
  ) {
    const baseScale = Math.max(CROP_BOX_W / data.width, CROP_BOX_H / data.height);
    const scale = baseScale * cropZoom;
    const scaledW = data.width * scale;
    const scaledH = data.height * scale;
    const maxX = Math.max(0, (scaledW - CROP_BOX_W) / 2);
    const maxY = Math.max(0, (scaledH - CROP_BOX_H) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  useEffect(() => {
    if (!cropData) return;
    setCropOffset((prev) => clampCropOffset(prev, cropData));
  }, [cropZoom, cropData]);

  async function runImageCheck(dataUrl: string) {
    const res = await fetch("/api/image-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    const data = await res.json();
    if (!res.ok || data?.message) {
      setImageCheckStatus("review");
      return;
    }
    if (data.decision === "block") {
      setImageCheckStatus("block");
      setImageUrl(null);
      setImageError(
        "This doesn’t look like a card photo. Please upload a picture of the card."
      );
      return;
    }
    setImageCheckStatus(data.decision === "review" ? "review" : "accept");
  }

  async function confirmCrop() {
    if (!cropData) return;
    const baseScale = Math.max(CROP_BOX_W / cropData.width, CROP_BOX_H / cropData.height);
    const scale = baseScale * cropZoom;
    const rawCropW = CROP_BOX_W / scale;
    const rawCropH = CROP_BOX_H / scale;
    const cropW = Math.min(cropData.width, rawCropW);
    const cropH = Math.min(cropData.height, rawCropH);
    const x = cropData.width / 2 + ((-CROP_BOX_W / 2 - cropOffset.x) / scale);
    const y = cropData.height / 2 + ((-CROP_BOX_H / 2 - cropOffset.y) / scale);
    const cropped = await cropImageDataUrl(cropData.dataUrl, {
      x: Math.max(0, Math.min(cropData.width - cropW, x)),
      y: Math.max(0, Math.min(cropData.height - cropH, y)),
      width: cropW,
      height: cropH,
    }, "image/webp", 0.92, { width: CROP_BOX_W, height: CROP_BOX_H });
    setImageUrl(cropped);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
    setShowCrop(false);
    setCropData(null);
    setImageCheckStatus("checking");
    await runImageCheck(cropped);
  }

  async function applyCropRotation(nextBase: number, nextFine: number) {
    if (!cropSource) return;
    try {
      const totalRotation = nextBase + nextFine;
      const rotated = await rotateImageDataUrl(cropSource.dataUrl, totalRotation);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        setCropData({ dataUrl: rotated, width, height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(nextBase);
        setCropRotationFine(nextFine);
      };
      img.onerror = () => {
        setImageError("Failed to rotate image.");
      };
      img.src = rotated;
    } catch {
      setImageError("Failed to rotate image.");
    }
  }

  const canSave = useMemo(() => {
    const baseOk = Boolean(playerName.trim() && year.trim() && setName.trim());
    if (!imageUrl) return baseOk;
    return baseOk && cardPhotoConfirm;
  }, [playerName, year, setName, imageUrl, cardPhotoConfirm]);

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

  function handleImageFile(file: File | null) {
    if (!file) return;
    setImageError("");
    setImageCheckStatus("checking");
    processImageFile(file)
      .then(async (result) => {
        setCropSource({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropData({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(0);
        setCropRotationFine(0);
        setShowCrop(true);
      })
      .catch((err: Error) => {
        setImageCheckStatus("idle");
        setImageError(err.message || "Image failed validation.");
      });
  }

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

      imageShared: isWishlistCard ? undefined : imageShare || undefined,
      imageType: isWishlistCard ? undefined : imageType,
    };

    return card;
  }

  async function onSave() {
    const input = buildCard();
    if (!input) return;
    setIsSaving(true);
    try {
      const profileId = await requireProfileId();
      const card = await createMyCard(profileId, input);
      if (!isWishlistCard && imageUrl) {
        saveImageForCard(String(card.id), imageUrl);
        await saveThumbnailForCard(String(card.id), imageUrl);
      }
      if (
        !isWishlistCard &&
        imageShare &&
        imageOwnerConfirm &&
        imageUrl &&
        fingerprint &&
        imageUrl.trim().length > 0
      ) {
        const res = await saveSharedImage({
          fingerprint,
          dataUrl: imageUrl,
          isFront: imageIsFront,
          isSlabbed: imageIsSlabbed,
          createdAt: new Date().toISOString(),
        });
        if (res.status === "error") {
          setImageError(`Shared image upload failed: ${res.message}`);
        } else if (res.status === "exists") {
          setImageError("Shared image already exists for this card.");
        }
      }
      router.push("/cards");
    } finally {
      setIsSaving(false);
    }
  }

  async function onSaveAndAddAnother() {
    const input = buildCard();
    if (!input) return;
    setIsSaving(true);
    try {
      const profileId = await requireProfileId();
      const card = await createMyCard(profileId, input);
      if (!isWishlistCard && imageUrl) {
        saveImageForCard(String(card.id), imageUrl);
        await saveThumbnailForCard(String(card.id), imageUrl);
      }

      if (
        !isWishlistCard &&
        imageShare &&
        imageOwnerConfirm &&
        imageUrl &&
        fingerprint &&
        imageUrl.trim().length > 0
      ) {
        const res = await saveSharedImage({
          fingerprint,
          dataUrl: imageUrl,
          isFront: imageIsFront,
          isSlabbed: imageIsSlabbed,
          createdAt: new Date().toISOString(),
        });
        if (res.status === "error") {
          setImageError(`Shared image upload failed: ${res.message}`);
        } else if (res.status === "exists") {
          setImageError("Shared image already exists for this card.");
        }
      }

      // reset form (keep your existing reset block EXACTLY as-is)
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
      setImageUrl(null);
      setImageIsFront(true);
      setImageIsSlabbed(false);
      setImageShare(false);
      setImageOwnerConfirm(false);
      setImageType("front");
      setImageError("");
      setImageCheckStatus("idle");
      setCardPhotoConfirm(false);
      setChecklistQuery("");
      setChecklistSection("ALL");
      setShowChecklistResults(true);
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

      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
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
                      {s.year} {s.name}
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

        {!isWishlistCard ? (
          <CardImageUploader
            imageUrl={imageUrl}
            setImageUrl={setImageUrl}
            imageType={imageType}
            setImageType={setImageType}
            setImageIsFront={setImageIsFront}
            setImageIsSlabbed={setImageIsSlabbed}
            cardPhotoConfirm={cardPhotoConfirm}
            setCardPhotoConfirm={setCardPhotoConfirm}
            imageOwnerConfirm={imageOwnerConfirm}
            setImageOwnerConfirm={setImageOwnerConfirm}
            imageShare={imageShare}
            setImageShare={setImageShare}
            imageError={imageError}
            imageCheckStatus={imageCheckStatus}
            sharedImage={sharedImage}
            reportInfo={reportInfo}
            fingerprint={fingerprint}
            onFileSelected={handleImageFile}
          />
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
            {isSaving ? "Saving…" : isWishlist ? "Add + Another" : "Save + Add Another"}
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="btn-primary"
          >
            {isSaving ? "Saving…" : isWishlist ? "Add to Wishlist" : "Save Card"}
          </button>
        </div>
      </div>

      <CardImageCropModal
        show={showCrop}
        cropData={cropData}
        setCropData={setCropData}
        setCropSource={setCropSource}
        setShowCrop={setShowCrop}
        setImageCheckStatus={setImageCheckStatus}
        setImageError={setImageError}
        cropOffset={cropOffset}
        setCropOffset={setCropOffset}
        cropDragRef={cropDragRef}
        clampCropOffset={clampCropOffset}
        cropZoom={cropZoom}
        setCropZoom={setCropZoom}
        cropRotationBase={cropRotationBase}
        cropRotationFine={cropRotationFine}
        applyCropRotation={applyCropRotation}
        confirmCrop={confirmCrop}
        cropBoxWidth={CROP_BOX_W}
        cropBoxHeight={CROP_BOX_H}
        cropZoomMin={CROP_ZOOM_MIN}
        cropZoomMax={CROP_ZOOM_MAX}
        cropRotationFineMin={CROP_ROTATION_FINE_MIN}
        cropRotationFineMax={CROP_ROTATION_FINE_MAX}
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
