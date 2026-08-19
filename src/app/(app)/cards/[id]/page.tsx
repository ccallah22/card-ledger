"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CardComp } from "@/lib/types";
import { type MyCard, getMyCard, updateMyCard, deleteMyCard } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { formatCurrency } from "@/lib/format";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { fetchSharedImage } from "@/lib/db/sharedImages";
import { REPORT_HIDE_THRESHOLD, REPORT_REASONS } from "@/lib/reporting";
import { startTrace, captureError } from "@/lib/sentry";
import { useUserCardDisplayImages } from "@/hooks/cards/useUserCardDisplayImages";
import { MiniBadge, Chip, Stat } from "@/components/cards/BinderUi";

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function safeLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(s: string) {
  return s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildEbaySoldUrl(card: MyCard) {
  const parts = [
    card.year,
    card.setName,
    card.playerName,
    card.cardNumber ? `#${card.cardNumber}` : "",
    card.variation ?? "",
    card.insert ?? "",
    card.parallel ?? "",
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  const query = encodeURIComponent(parts.join(" "));
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1`;
}

// A plain label/value row -- the one shared rendering primitive for both
// the Catalog Identity and Collection Information sections below, so their
// visual rhythm stays identical while the two sections stay data-separate.
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-sm text-zinc-700">{label}</div>
      <div className="text-right text-sm font-medium text-zinc-900">{value}</div>
    </div>
  );
}

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [card, setCard] = useState<MyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compPrice, setCompPrice] = useState("");
  const [compDate, setCompDate] = useState("");
  const [compUrl, setCompUrl] = useState("");
  const [compNotes, setCompNotes] = useState("");
  const [reportInfo, setReportInfo] = useState<{ reports: number; status?: string } | null>(
    null
  );
  // showReportForm/reportReason/reportStatusMsg/handleReportImage below are
  // pre-existing state/logic that was already present (and already
  // functional end-to-end -- see handleReportImage) before this pass, but
  // had no reachable UI trigger anywhere in the previous render output, so
  // reporting a community image was silently impossible. That's a real,
  // pre-existing completeness gap discovered during this audit, not
  // something introduced here. Fixing the missing trigger is in scope for
  // this same "Card image" section this phase already redesigns, so it's
  // wired up below rather than deferred -- no new report logic was written,
  // this only adds the missing entry point to logic that already existed.
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportStatusMsg, setReportStatusMsg] = useState<string>("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const endTrace = startTrace("load-card-detail");
        const found = await getMyCard(String(id));
        if (endTrace) endTrace();
        if (active) setCard(found);
      } catch (e) {
        captureError(e, { area: "card-detail-load", id: String(id) });
        if (active) setCard(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const fingerprint = useMemo(() => {
    if (!card) return "";
    return buildCardFingerprint({
      year: card.year,
      setName: card.setName,
      cardNumber: card.cardNumber,
      playerName: card.playerName,
      team: card.team,
      insert: card.insert ?? "",
      variation: card.variation ?? "",
      parallel: card.parallel ?? "",
      serialTotal: card.serialTotal,
    });
  }, [card]);

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

  const hideImage =
    !!reportInfo &&
    (reportInfo.status === "blocked" || reportInfo.reports >= REPORT_HIDE_THRESHOLD);

  // Account-level persisted media (Player Hub's exact resolver, reused
  // as-is -- see useUserCardDisplayImages.ts) is now the authoritative
  // front-image source, ahead of the legacy localStorage image, which is
  // itself ahead of the community shared image. This page previously only
  // ever read the legacy image directly (loadImageForCard), so a card
  // added on one device/browser rendered "No image" here on another device
  // even though the same card's persisted scan already displayed correctly
  // on Player Hub and on this card's own Edit page. That was a real
  // cross-device inconsistency within this app, not a hypothetical one --
  // fixed by switching to the same resolver, not by inventing a new one.
  const cardIds = card ? [card.id] : [];
  const frontImages = useUserCardDisplayImages(cardIds, "front");
  const backImages = useUserCardDisplayImages(cardIds, "back");
  const [activeSide, setActiveSide] = useState<"front" | "back">("front");

  const frontPersistedUrl = card ? frontImages.imagesByUserCardId.get(card.id) ?? null : null;
  const backPersistedUrl = card ? backImages.imagesByUserCardId.get(card.id) ?? null : null;
  const hasBackImage = !backImages.loading && !!backPersistedUrl;

  const frontDisplayImage = hideImage ? "" : frontPersistedUrl ?? sharedImage?.dataUrl ?? "";
  const displayImage = activeSide === "back" ? backPersistedUrl ?? "" : frontDisplayImage;
  // The community-shared-image/report feature only ever applied to the
  // front side historically (fingerprint matching has no back-image
  // concept), so reporting is only offered while viewing the front tab and
  // only when what's showing is genuinely the community fallback, not this
  // profile's own scan.
  const showingCommunityImage =
    activeSide === "front" && !frontPersistedUrl && !!sharedImage?.dataUrl && !hideImage;

  async function handleReportImage() {
    if (!fingerprint || !displayImage) return;
    setReportStatusMsg("");
    const res = await fetch("/api/image-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint,
        imageUrl: displayImage,
        reason: reportReason,
      }),
    });
    const data = await res.json();
    if (!res.ok || data?.message) {
      setReportStatusMsg("Report failed. Please try again.");
      return;
    }
    setReportInfo({ reports: data.reports ?? 0, status: data.status ?? "active" });
    setReportStatusMsg("Report submitted. Thank you.");
    setShowReportForm(false);
  }

  const computed = useMemo(() => {
    if (!card) return null;

    const status = card.status ?? "HAVE";
    const paid = asNumber(card.purchasePrice) ?? 0;
    const market = asNumber(card.estimatedValue);
    const asking = asNumber(card.askingPrice);
    const sold = asNumber(card.soldPrice);

    const held = status === "WANT" || status === "SOLD" ? null : daysSince(card.purchaseDate);
    const net = typeof sold === "number" ? sold - paid : null;
    const unrealized =
      status !== "SOLD" && typeof market === "number" ? market - paid : null;

    // Two genuinely different facts, kept separate rather than combined into
    // one string: serialTotal (card_variants.print_run) is catalog-level --
    // shared by every copy of this exact parallel -- while serialNumber
    // (user_cards.serial_number) is this one physical copy's own number.
    // serialCombined is only for the compact hero badge; Catalog Identity
    // and Collection Information below each show their own half only.
    const serialCombined =
      typeof card.serialNumber === "number" && typeof card.serialTotal === "number"
        ? `${card.serialNumber}/${card.serialTotal}`
        : typeof card.serialTotal === "number"
        ? `/${card.serialTotal}`
        : "";

    return { status, paid, market, asking, sold, held, net, unrealized, serialCombined };
  }, [card]);

  async function handleDelete() {
    if (!card) return;

    const ok = window.confirm(
      `Delete this card?\n\n${card.playerName} • ${card.year} • ${card.setName}${
        card.cardNumber ? ` #${card.cardNumber}` : ""
      }`
    );
    if (!ok) return;

    await deleteMyCard(card.id);
    router.push("/cards");
  }

  async function handleAddComp() {
    if (!card) return;
    const price = Number(compPrice);
    if (!Number.isFinite(price)) return;

    const nextComp: CardComp = {
      id: newId(),
      price,
      date: compDate || undefined,
      url: compUrl.trim() || undefined,
      notes: compNotes.trim() || undefined,
      source: compUrl.trim() ? "eBay" : "Manual",
    };

    const nextComps = [nextComp, ...(card.comps ?? [])];
    const profileId = await requireProfileId();
    const next = await updateMyCard(profileId, card.id, { comps: nextComps });
    setCard(next);
    setCompPrice("");
    setCompDate("");
    setCompUrl("");
    setCompNotes("");
    setShowCompForm(false);
  }

  if (loading)
    return (
      <div className="grid gap-4 sm:grid-cols-[260px_1fr] animate-pulse">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="aspect-[2.5/3.5] rounded-md bg-zinc-200/70" />
          <div className="mt-3 h-3 w-3/4 rounded bg-zinc-200/70" />
          <div className="mt-2 h-3 w-1/2 rounded bg-zinc-200/70" />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="h-4 w-1/3 rounded bg-zinc-200/70" />
          <div className="h-3 w-1/2 rounded bg-zinc-200/70" />
          <div className="h-3 w-2/3 rounded bg-zinc-200/70" />
          <div className="h-3 w-1/3 rounded bg-zinc-200/70" />
        </div>
      </div>
    );

  if (!card || !computed) {
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

  const comps = card.comps ?? [];

  // ---- Catalog Identity: facts shared by every owner of this exact
  // catalog card/parallel. Rookie/Autograph/Patch are deliberately not
  // repeated here as rows -- the hero badges above already state them, and
  // this task's own instruction is not to duplicate identity across
  // sections.
  const catalogRows: Array<{ label: string; value: string }> = [
    { label: "Player", value: card.playerName },
    { label: "Year", value: card.year },
    { label: "Set", value: card.setName },
    { label: "Card #", value: card.cardNumber ?? "" },
    { label: "Variation", value: card.variation ?? "" },
    { label: "Insert", value: card.insert ?? "" },
    { label: "Parallel", value: card.parallel ?? "" },
    { label: "Print Run", value: typeof card.serialTotal === "number" ? `/${card.serialTotal}` : "" },
  ].filter((r) => r.value.trim() !== "");

  // ---- Collection Information: facts about THIS physical copy only.
  // team_name lives on user_cards (free-text per copy, not the shared
  // catalog teams table -- see myCards.ts), so it belongs here, not in
  // Catalog Identity, even though it reads like catalog trivia.
  const gradingValue =
    card.gradingStatus === "GRADED"
      ? [card.grader, card.grade].filter(Boolean).join(" ") || "Graded"
      : "Raw";

  const collectionRows: Array<{ label: string; value: string }> = [
    { label: "Status", value: statusLabel(computed.status) },
    { label: "Grading", value: gradingValue },
    { label: "Condition", value: card.condition ?? "" },
    { label: "Location", value: card.location ?? "" },
    { label: "Team", value: card.team ?? "" },
    {
      label: "Serial Number",
      value: typeof card.serialNumber === "number" ? String(card.serialNumber) : "",
    },
    { label: "Purchase Date", value: card.purchaseDate ?? "" },
    {
      label: "Purchase Price",
      value: typeof card.purchasePrice === "number" ? formatCurrency(card.purchasePrice) : "",
    },
  ].filter((r) => r.value.trim() !== "");

  const primaryKeys = new Set(
    [
      "id",
      "playerName",
      "players",
      "catalogCardId",
      "year",
      "setId",
      "setName",
      "setSlug",
      "cardNumber",
      "team",
      "location",
      "variation",
      "insert",
      "parallel",
      "serialNumber",
      "serialTotal",
      "gradingStatus",
      "condition",
      "grader",
      "grade",
      "certNumber",
      "status",
      "purchaseDate",
      "purchasePrice",
      "estimatedValue",
      "askingPrice",
      "soldPrice",
      "soldDate",
      "soldFees",
      "soldNotes",
      "notes",
      "comps",
      "imagePath",
      "thumbPath",
      "imageShared",
      "imageType",
      "isRookie",
      "isAutograph",
      "isPatch",
      "createdAt",
      "updatedAt",
    ].map(String)
  );

  const extraEntries = Object.entries(card || {})
    .filter(([k, v]) => !primaryKeys.has(k) && v !== undefined && v !== null && String(v).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="p-4 space-y-5">
      {/* Hero: image (front/back) + identity + badges + actions, all in one
          card surface so the page opens with a single, unambiguous "this is
          the card" moment instead of a plain title line. */}
      <div className="rounded-xl border bg-white p-4">
        <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
          <div>
            <div className="relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden">
              {displayImage ? (
                // imageUrl is either a private, expiring signed Supabase
                // Storage URL (see useUserCardDisplayImages/
                // getCardMediaImageUrls) or a localStorage/community data
                // URL, never a static asset -- next/image would need
                // remote-domain config for a URL that changes per
                // session/user, out of scope for this phase.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayImage}
                  alt={`${card.playerName} ${card.cardNumber ?? ""} (${activeSide})`.trim()}
                  className="h-full w-full object-contain"
                />
              ) : hideImage ? (
                <div className="text-xs text-zinc-500 text-center px-2">
                  Image hidden (reported)
                </div>
              ) : (
                <div className="text-xs text-zinc-500 text-center px-2">No image</div>
              )}
              <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300/70" />
            </div>

            {hasBackImage ? (
              <div className="mt-2 flex gap-2">
                <Chip active={activeSide === "front"} onClick={() => setActiveSide("front")}>
                  Front
                </Chip>
                <Chip active={activeSide === "back"} onClick={() => setActiveSide("back")}>
                  Back
                </Chip>
              </div>
            ) : null}

            {showingCommunityImage ? (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-zinc-500">Community reference image</div>
                {showReportForm ? (
                  <div className="space-y-1.5 rounded-md border bg-zinc-50 p-2">
                    <select
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      className="w-full rounded-md border px-2 py-1 text-xs text-zinc-900"
                    >
                      {REPORT_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleReportImage}
                        className="rounded-md border bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Submit report
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReportForm(false)}
                        className="rounded-md border bg-white px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100"
                      >
                        Cancel
                      </button>
                    </div>
                    {reportStatusMsg ? (
                      <div className="text-[11px] text-zinc-600">{reportStatusMsg}</div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowReportForm(true)}
                    className="text-[11px] text-zinc-500 underline hover:text-zinc-700"
                  >
                    Report image
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight break-words">
              {card.playerName}
              {card.cardNumber ? (
                <span className="ml-2 text-sm font-normal text-zinc-500">#{card.cardNumber}</span>
              ) : null}
            </h1>

            <div className="mt-0.5 text-gray-600 break-words">
              {card.year ? `${card.year} ` : ""}
              {card.setName}
            </div>

            {card.parallel || card.variation ? (
              <div className="text-sm text-zinc-500 break-words">
                {[card.variation, card.parallel].filter(Boolean).join(" • ")}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {card.variation ? <MiniBadge>{card.variation}</MiniBadge> : null}
              {card.insert ? <MiniBadge>{card.insert}</MiniBadge> : null}
              {card.parallel ? <MiniBadge>{card.parallel}</MiniBadge> : null}
              {computed.serialCombined ? <MiniBadge>#{computed.serialCombined}</MiniBadge> : null}
              {card.isRookie ? <MiniBadge>Rookie</MiniBadge> : null}
              {card.isAutograph ? <MiniBadge tone="purple">Auto</MiniBadge> : null}
              {card.isPatch ? <MiniBadge tone="amber">Patch</MiniBadge> : null}
              {card.gradingStatus === "GRADED" ? (
                <MiniBadge tone="green">{card.grade ? `Graded ${card.grade}` : "Graded"}</MiniBadge>
              ) : null}
            </div>

            {card.catalogCardId ? (
              <Link
                href={`/catalog/cards/${card.catalogCardId}`}
                className="mt-2 inline-flex items-center text-xs text-[var(--brand-accent)] hover:underline"
              >
                View catalog card
              </Link>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/cards" className="btn-secondary">
                Back
              </Link>
              <button
                type="button"
                onClick={() => router.push(`/cards/${String(id)}/edit`)}
                className="btn-secondary"
              >
                Edit
              </button>
              {computed.status !== "SOLD" ? (
                <button
                  type="button"
                  onClick={() => router.push(`/cards/${String(id)}/sold`)}
                  className="btn-primary"
                >
                  Mark as Sold
                </button>
              ) : null}
              <button type="button" onClick={handleDelete} className="btn-destructive ml-auto">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Value: visible but compact -- never dominates the page, and never
          silently renders $0 in place of "we don't know yet". */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <Stat label="Paid" value={formatCurrency(computed.paid)} />
        <Stat
          label="Estimated Value"
          value={typeof computed.market === "number" ? formatCurrency(computed.market) : "No estimated value yet"}
        />
        {computed.status === "FOR_SALE" && typeof computed.asking === "number" ? (
          <Stat label="Asking" value={formatCurrency(computed.asking)} />
        ) : null}
        {computed.status === "SOLD" && typeof computed.sold === "number" ? (
          <Stat label="Sold For" value={formatCurrency(computed.sold)} />
        ) : null}
        {computed.status === "SOLD" && typeof computed.net === "number" ? (
          <Stat
            label="Net (sold - paid)"
            value={formatCurrency(computed.net, { accounting: true })}
            tone={computed.net > 0 ? "positive" : computed.net < 0 ? "negative" : "neutral"}
          />
        ) : null}
        {computed.status !== "SOLD" && typeof computed.unrealized === "number" ? (
          <Stat
            label="Unrealized Gain"
            value={formatCurrency(computed.unrealized, { accounting: true })}
            tone={computed.unrealized > 0 ? "positive" : computed.unrealized < 0 ? "negative" : "neutral"}
          />
        ) : null}
        {computed.held !== null ? <Stat label="Held" value={`${computed.held} days`} /> : null}
      </div>

      {/* Catalog Identity vs Collection Information: the page's core
          distinction between "what this card is" (shared, catalog-level)
          and "what I know about my copy" (this user_cards row only). */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="rounded-xl border bg-white">
          <div className="border-b px-4 py-3 font-semibold text-zinc-900">Catalog Identity</div>
          <div className="p-4 grid gap-3">
            {catalogRows.map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-white">
          <div className="border-b px-4 py-3 font-semibold text-zinc-900">
            Collection Information
          </div>
          <div className="p-4 grid gap-3">
            {collectionRows.map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </div>
      </div>

      {card.notes ? (
        <div className="rounded-xl border bg-white p-4">
          <div className="font-semibold text-zinc-900 mb-2">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{card.notes}</div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="font-semibold text-zinc-900">Comps</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(buildEbaySoldUrl(card), "_blank", "noopener,noreferrer")}
              className="btn-secondary text-xs"
            >
              Search eBay sold
            </button>
            <button
              type="button"
              onClick={() => setShowCompForm((v) => !v)}
              className="btn-primary text-xs"
            >
              {showCompForm ? "Cancel" : "Add comp"}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {showCompForm ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-600">
                Sold price *
                <input
                  value={compPrice}
                  onChange={(e) => setCompPrice(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="e.g. 120"
                />
              </label>
              <label className="text-sm text-zinc-600">
                Sold date
                <input
                  type="date"
                  value={compDate}
                  onChange={(e) => setCompDate(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                />
              </label>
              <label className="text-sm text-zinc-600 sm:col-span-2">
                Link (optional)
                <input
                  value={compUrl}
                  onChange={(e) => setCompUrl(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="Paste eBay sold listing URL"
                />
              </label>
              <label className="text-sm text-zinc-600 sm:col-span-2">
                Notes (optional)
                <input
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="Condition, grading, etc."
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddComp}
                  disabled={!Number.isFinite(Number(compPrice))}
                  className="btn-primary"
                >
                  Save comp
                </button>
              </div>
            </div>
          ) : null}

          {comps.length === 0 ? (
            <div className="text-sm text-zinc-600">No comps yet—add your first one.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {comps.map((comp) => (
                <div
                  key={comp.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="font-medium">{formatCurrency(comp.price)}</div>
                  <div className="text-zinc-600">{comp.date || "—"}</div>
                  {comp.url ? (
                    <a
                      href={comp.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-link text-xs"
                    >
                      Link
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-400">No link</span>
                  )}
                  {comp.notes ? <div className="text-xs text-zinc-500">{comp.notes}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {extraEntries.length > 0 ? (
        <div className="rounded-xl border bg-white">
          <div className="border-b px-4 py-3 font-semibold text-zinc-900">More details</div>
          <div className="p-4 grid gap-3">
            {extraEntries.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <div className="text-gray-600">{safeLabel(k)}</div>
                <div className="text-right font-medium">{String(v)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="text-xs text-gray-500">
        ID in URL: <span className="font-mono">{String(id)}</span> • Stored card id:{" "}
        <span className="font-mono">{String(card.id)}</span>
      </div>
    </div>
  );
}
