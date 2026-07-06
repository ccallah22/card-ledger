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
import { loadImageForCard } from "@/lib/imageStore";
import { startTrace, captureError } from "@/lib/sentry";

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

  const storedImage = card ? loadImageForCard(card.id) : null;
  const displayImage = hideImage ? "" : storedImage ?? sharedImage?.dataUrl ?? "";

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

    const serial =
      typeof card.serialNumber === "number" && typeof card.serialTotal === "number"
        ? `${card.serialNumber}/${card.serialTotal}`
        : typeof card.serialTotal === "number"
        ? `/${card.serialTotal}`
        : "";

    return { status, paid, market, asking, sold, held, net, unrealized, serial };
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

  const location = card.location;
  const comps = card.comps ?? [];

  const primaryRows: Array<{ label: string; value: any; format?: "currency" | "text" }> = [
    { label: "Player", value: card.playerName, format: "text" },
    { label: "Year", value: card.year, format: "text" },
    { label: "Set", value: card.setName, format: "text" },
    { label: "Card #", value: card.cardNumber ?? "", format: "text" },
    { label: "Team", value: card.team ?? "", format: "text" },

    { label: "Location", value: location ?? "", format: "text" },

    { label: "Variation", value: card.variation ?? "", format: "text" },
    { label: "Insert", value: card.insert ?? "", format: "text" },
    { label: "Parallel", value: card.parallel ?? "", format: "text" },
    { label: "Serial", value: computed.serial, format: "text" },

    { label: "Condition", value: card.condition ?? "", format: "text" },
    { label: "Grader", value: card.grader ?? "", format: "text" },
    { label: "Grade", value: card.grade ?? "", format: "text" },

    { label: "Status", value: statusLabel(computed.status), format: "text" },
    { label: "Purchase date", value: card.purchaseDate ?? "", format: "text" },

    { label: "Paid", value: card.purchasePrice, format: "currency" },
    { label: "Market value", value: card.estimatedValue, format: "currency" },
    { label: "Asking", value: card.askingPrice, format: "currency" },
    { label: "Sold", value: card.soldPrice, format: "currency" },
  ];

  const primaryKeys = new Set(
    [
      "id",
      "playerName",
      "year",
      "setName",
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">
            {card.playerName}
            {card.cardNumber ? (
              <span className="ml-2 text-sm text-zinc-500">#{card.cardNumber}</span>
            ) : null}
          </h1>

          <div className="text-gray-600">
            {card.year ? `${card.year} ` : ""}
            {card.setName}
          </div>

          {location ? <div className="mt-1 text-sm text-zinc-500">{location}</div> : null}

          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
            {card.variation ? <MiniBadge>{card.variation}</MiniBadge> : null}
            {card.insert ? <MiniBadge>{card.insert}</MiniBadge> : null}
            {card.parallel ? <MiniBadge>{card.parallel}</MiniBadge> : null}
            {computed.serial ? <MiniBadge>#{computed.serial}</MiniBadge> : null}
            {card.isRookie ? <MiniBadge tone="blue">Rookie</MiniBadge> : null}
            {card.isAutograph ? <MiniBadge tone="purple">Auto</MiniBadge> : null}
            {card.isPatch ? <MiniBadge tone="amber">Patch</MiniBadge> : null}
          </div>

          {card.team ? <div className="mt-1 text-sm text-zinc-500">{card.team}</div> : null}
        </div>

        {/* ✅ Horizontal actions (no URL style, no Sold History button, Delete stays) */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

          <button
            type="button"
            onClick={handleDelete}
            className="btn-destructive"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="font-semibold text-zinc-900">Card image</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
          <div className="relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden">
            {displayImage ? (
              <img
                src={displayImage}
                alt={`${card.playerName} ${card.cardNumber ?? ""}`.trim()}
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

          <div className="space-y-2 text-sm text-zinc-600">
            <div>
              Image editing is available only on the edit screen.
            </div>
            <Link
              href={`/cards/${String(id)}/edit`}
              className="inline-flex items-center rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Edit card
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-2 bg-white">
        <div className="font-semibold text-zinc-900">Card summary</div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-gray-600">Paid:</span>{" "}
            <span className="font-semibold">{formatCurrency(computed.paid)}</span>
          </div>

          {typeof computed.asking === "number" ? (
            <div>
              <span className="text-gray-600">Asking:</span>{" "}
              <span className="font-semibold">{formatCurrency(computed.asking)}</span>
            </div>
          ) : null}

          {typeof computed.market === "number" ? (
            <div>
              <span className="text-gray-600">Market value:</span>{" "}
              <span className="font-semibold">{formatCurrency(computed.market)}</span>
            </div>
          ) : null}

          {computed.status === "SOLD" && typeof computed.sold === "number" ? (
            <div>
              <span className="text-gray-600">Sold for:</span>{" "}
              <span className="font-semibold">{formatCurrency(computed.sold)}</span>
            </div>
          ) : null}

          {computed.status === "SOLD" && typeof computed.net === "number" ? (
            <div>
              <span className="text-gray-600">Net (sold - paid):</span>{" "}
              <span className="font-semibold">
                {formatCurrency(computed.net, { accounting: true })}
              </span>
            </div>
          ) : null}

          {computed.status !== "SOLD" && typeof computed.unrealized === "number" ? (
            <div>
              <span className="text-gray-600">Unrealized gain:</span>{" "}
              <span className="font-semibold">
                {formatCurrency(computed.unrealized, { accounting: true })}
              </span>
            </div>
          ) : null}

          {computed.held !== null ? (
            <div>
              <span className="text-gray-600">Held:</span>{" "}
              <span className="font-semibold">{computed.held} days</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-semibold text-zinc-900">Details</div>
        <div className="p-4 grid gap-3">
          {primaryRows
            .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== "")
            .map((row) => {
              const display =
                row.format === "currency"
                  ? typeof row.value === "number"
                    ? formatCurrency(row.value)
                    : String(row.value ?? "")
                  : String(row.value);

              return (
                <div key={row.label} className="flex items-start justify-between gap-4">
                  <div className="text-sm text-zinc-700">{row.label}</div>
                  <div className="text-right text-sm font-medium text-zinc-900">{display}</div>
                </div>
              );
            })}
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

function MiniBadge({
  children,
  tone = "zinc",
}: {
  children: React.ReactNode;
  tone?: "zinc" | "blue" | "purple" | "amber";
}) {
  const cls =
    tone === "blue"
      ? "border-zinc-300 bg-zinc-100 text-zinc-200"
      : tone === "purple"
      ? "border-purple-200 bg-purple-50 text-purple-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-zinc-200 bg-white text-zinc-700";

  return <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{children}</span>;
}
