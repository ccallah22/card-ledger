"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { dbLoadCards } from "@/lib/db/cards";
import { formatCurrency } from "@/lib/format";

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function monthKey(yyyyMmDd: string) {
  return yyyyMmDd.slice(0, 7);
}

function fmtMonth(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function parseLocalDate(dateStr: string): Date | null {
  // supports "YYYY-MM-DD"
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysBetween(purchaseDate?: string, soldDate?: string): number | null {
  const p = purchaseDate ? parseLocalDate(purchaseDate) : null;
  const s = soldDate ? parseLocalDate(soldDate) : null;
  if (!p || !s) return null;
  const ms = s.getTime() - p.getTime();
  // If dates are reversed or weird, clamp to 0
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

type TrendPoint = { xLabel: string; value: number };

function LineChart({ points, height = 140 }: { points: TrendPoint[]; height?: number }) {
  const width = 640;
  const pad = 18;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const n = points.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const coords = points.map((p, i) => {
    const x = pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad + (1 - (p.value - minV) / range) * innerH;
    return { x, y };
  });

  const poly = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");

  const firstLabel = points[0]?.xLabel;
  const lastLabel = points[points.length - 1]?.xLabel;

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Realized Net Trend</div>
          <div className="text-xs text-zinc-500">Cumulative realized net over time</div>
        </div>
        <div className="text-xs text-zinc-500" />
      </div>

      <svg
        viewBox={`0 0 ${width} 0 ${height}`}
        className="h-[160px] w-full text-zinc-800"
        role="img"
      >
        <line x1={pad} y1={pad} x2={width - pad} y2={pad} stroke="currentColor" opacity="0.08" />
        <line
          x1={pad}
          y1={pad + innerH / 2}
          x2={width - pad}
          y2={pad + innerH / 2}
          stroke="currentColor"
          opacity="0.08"
        />
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="currentColor"
          opacity="0.08"
        />

        <polyline fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" points={poly} />
        {coords.map((c, idx) => (
          <circle key={idx} cx={c.x} cy={c.y} r="3" fill="currentColor" opacity="0.9" />
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <div>{firstLabel ? fmtMonth(firstLabel) : ""}</div>
        <div>{lastLabel ? fmtMonth(lastLabel) : ""}</div>
      </div>
    </div>
  );
}

type Extreme = {
  id: string;
  label: string;
  pl: number;
};

export default function SoldHistoryPage() {
  const [cards, setCards] = useState<SportsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = await dbLoadCards();
        if (active) setCards(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load cards");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const soldCards = useMemo(() => {
    return cards
      .filter((c) => (c.status ?? "HAVE") === "SOLD")
      .slice()
      .sort((a, b) => {
        const ad = ((a as any).soldDate as string | undefined) ?? "";
        const bd = ((b as any).soldDate as string | undefined) ?? "";
        return bd.localeCompare(ad); // newest first
      });
  }, [cards]);

  const totals = useMemo(() => {
    const totalSold = soldCards.reduce((sum, c) => sum + (asNumber((c as any).soldPrice) ?? 0), 0);
    const totalPaid = soldCards.reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);
    const realizedNet = totalSold - totalPaid;

    const count = soldCards.length;

    const wins = soldCards.filter((c) => {
      const pl = (asNumber((c as any).soldPrice) ?? 0) - (asNumber(c.purchasePrice) ?? 0);
      return pl > 0;
    }).length;

    const losses = soldCards.filter((c) => {
      const pl = (asNumber((c as any).soldPrice) ?? 0) - (asNumber(c.purchasePrice) ?? 0);
      return pl < 0;
    }).length;

    const winRate = count > 0 ? wins / count : 0;
    const avgProfit = count > 0 ? realizedNet / count : 0;

    const roi = totalPaid > 0 ? realizedNet / totalPaid : 0;

    // Best / worst
    let best: Extreme | null = null;
    let worst: Extreme | null = null;

    // Time to sell stats
    const holdDays: number[] = [];

    for (const c of soldCards) {
      const soldPrice = asNumber((c as any).soldPrice) ?? 0;
      const paid = asNumber(c.purchasePrice) ?? 0;
      const pl = soldPrice - paid;

      const label = `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;

      if (!best || pl > best.pl) best = { id: c.id, label, pl };
      if (!worst || pl < worst.pl) worst = { id: c.id, label, pl };

      const soldDate = ((c as any).soldDate as string | undefined) ?? "";
      const d = daysBetween(c.purchaseDate, soldDate);
      if (typeof d === "number") holdDays.push(d);
    }

    holdDays.sort((a, b) => a - b);
    const holdCount = holdDays.length;

    const avgDaysToSell = holdCount > 0 ? holdDays.reduce((s, v) => s + v, 0) / holdCount : 0;

    const medianDaysToSell =
      holdCount > 0
        ? holdCount % 2 === 1
          ? holdDays[(holdCount - 1) / 2]
          : (holdDays[holdCount / 2 - 1] + holdDays[holdCount / 2]) / 2
        : 0;

    return {
      totalSold,
      totalPaid,
      realizedNet,
      wins,
      losses,
      winRate,
      avgProfit,
      count,
      roi,
      best,
      worst,
      avgDaysToSell,
      medianDaysToSell,
      holdCount,
    };
  }, [soldCards]);

  const trend = useMemo<TrendPoint[]>(() => {
    const byMonth = new Map<string, number>();

    for (const c of soldCards) {
      const soldDate = ((c as any).soldDate as string | undefined) ?? "";
      const soldPrice = asNumber((c as any).soldPrice) ?? 0;
      const paid = asNumber(c.purchasePrice) ?? 0;

      if (!soldDate) continue;
      const key = monthKey(soldDate);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (soldPrice - paid));
    }

    const months = Array.from(byMonth.keys()).sort();
    let running = 0;

    const points = months.map((m) => {
      running += byMonth.get(m) ?? 0;
      return { xLabel: m, value: running };
    });

    return points.length ? points : [{ xLabel: new Date().toISOString().slice(0, 7), value: 0 }];
  }, [soldCards]);

  const netTone = totals.realizedNet > 0 ? "positive" : totals.realizedNet < 0 ? "negative" : "neutral";
  const avgTone = totals.avgProfit > 0 ? "positive" : totals.avgProfit < 0 ? "negative" : "neutral";
  const roiTone = totals.roi > 0 ? "positive" : totals.roi < 0 ? "negative" : "neutral";

  const roiPct = `${Math.round(totals.roi * 100)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sold History</h1>
          <p className="text-sm text-zinc-600">Realized performance based on actual sold prices.</p>
        </div>

        <Link href="/cards" className="btn-secondary">
          Back to Binder
        </Link>
      </div>

      {/* Trend */}
      <LineChart points={trend} />

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Stat label="Total sold" value={formatCurrency(totals.totalSold)} />
        <Stat label="Total paid" value={formatCurrency(totals.totalPaid)} />
        <Stat
          label="Realized Net"
          value={formatCurrency(totals.realizedNet, { accounting: true })}
          tone={netTone}
        />
        <Stat label="Win rate" value={`${Math.round(totals.winRate * 100)}%`} />
      </div>

      {/* Best / Worst callouts */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ExtremeCard
          title="Best sale"
          extreme={totals.best}
          tone={totals.best && totals.best.pl >= 0 ? "positive" : "neutral"}
        />
        <ExtremeCard
          title="Worst sale"
          extreme={totals.worst}
          tone={totals.worst && totals.worst.pl < 0 ? "negative" : "neutral"}
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-12 gap-2 border-b bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-600">
          <div className="col-span-4">Card</div>
          <div className="col-span-2 whitespace-nowrap">Sold date</div>
          <div className="col-span-1 text-right">Days</div>
          <div className="col-span-2 text-right">Paid</div>
          <div className="col-span-2 text-right">Sold</div>
          <div className="col-span-1 text-right">P/L</div>
        </div>

        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`sold-skel-${i}`} className="px-4 py-3 animate-pulse">
                <div className="grid grid-cols-12 gap-2 text-sm">
                  <div className="col-span-4 space-y-2">
                    <div className="h-3 w-3/4 rounded bg-zinc-200/70" />
                    <div className="h-3 w-1/2 rounded bg-zinc-200/70" />
                  </div>
                  <div className="col-span-2 h-3 w-3/4 rounded bg-zinc-200/70" />
                  <div className="col-span-1 h-3 w-2/3 rounded bg-zinc-200/70" />
                  <div className="col-span-2 h-3 w-3/4 rounded bg-zinc-200/70" />
                  <div className="col-span-2 h-3 w-3/4 rounded bg-zinc-200/70" />
                  <div className="col-span-1 h-3 w-2/3 rounded bg-zinc-200/70" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="error-state">We couldn’t load your sold history. {error}</div>
        ) : soldCards.length === 0 ? (
          <div className="empty-state">No sold cards yet.</div>
        ) : (
          <ul className="divide-y">
            {soldCards.map((c) => {
              const soldDate = ((c as any).soldDate as string | undefined) ?? "";
              const soldPrice = asNumber((c as any).soldPrice) ?? 0;
              const paid = asNumber(c.purchasePrice) ?? 0;
              const pl = soldPrice - paid;

              const hold = daysBetween(c.purchaseDate, soldDate);

              const plClass =
                pl > 0 ? "text-emerald-700" : pl < 0 ? "text-red-700" : "text-zinc-700";

              return (
                <li key={c.id} className="px-4 py-3 hover:bg-zinc-50">
                  <Link href={`/cards/${c.id}`} className="block">
                    <div className="grid grid-cols-12 gap-2 text-sm">
                      <div className="col-span-4">
                        <div className="font-medium">
                          {c.playerName}
                          <span className="ml-2 text-xs text-zinc-500">
                            • {c.year} • {c.setName}
                            {c.cardNumber ? ` • #${c.cardNumber}` : ""}
                          </span>
                        </div>
                        {c.team ? <div className="text-xs text-zinc-500">{c.team}</div> : null}
                      </div>

                      <div className="col-span-2 whitespace-nowrap text-zinc-700">
                        {soldDate || "—"}
                      </div>

                      <div className="col-span-1 text-right tabular-nums text-zinc-700">
                        {typeof hold === "number" ? `${hold}` : "—"}
                      </div>

                      <div className="col-span-2 text-right tabular-nums text-zinc-700">
                        {paid ? formatCurrency(paid) : "—"}
                      </div>

                      <div className="col-span-2 text-right tabular-nums text-zinc-700">
                        {soldPrice ? formatCurrency(soldPrice) : "—"}
                      </div>

                      <div className={`col-span-1 text-right tabular-nums font-semibold ${plClass}`}>
                        {formatCurrency(pl, { accounting: true })}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- components ---------- */

function ExtremeCard({
  title,
  extreme,
  tone,
}: {
  title: string;
  extreme: { id: string; label: string; pl: number } | null;
  tone: "neutral" | "positive" | "negative";
}) {
  const borderClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "negative"
      ? "border-red-200 bg-red-50"
      : "border-zinc-200 bg-white";

  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
      ? "text-red-700"
      : "text-zinc-900";

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="text-[11px] text-zinc-500 leading-snug">{title}</div>
      {extreme ? (
        <div className="mt-1">
          <div className="text-sm font-medium text-zinc-900 break-words">{extreme.label}</div>
          <div className={`mt-1 text-base sm:text-lg font-semibold ${valueClass}`}>
            {formatCurrency(extreme.pl, { accounting: true })}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-zinc-600">No sold cards yet.</div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
      ? "text-red-700"
      : "text-zinc-900";

  const borderClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "negative"
      ? "border-red-200 bg-red-50"
      : "border-zinc-200 bg-white";

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="text-[11px] text-zinc-500 leading-snug break-words">{label}</div>
      <div className={`mt-1 text-lg sm:text-xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
