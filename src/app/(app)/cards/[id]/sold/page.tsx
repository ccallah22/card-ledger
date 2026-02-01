"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { getCard, upsertCard } from "@/lib/storage";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function MarkSoldPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<SportsCard | null>(null);

  const [soldPrice, setSoldPrice] = useState<string>("");
  const [soldDate, setSoldDate] = useState<string>("");
  const [soldFees, setSoldFees] = useState<string>("");
  const [soldNotes, setSoldNotes] = useState<string>("");

  useEffect(() => {
    const initial = getCard(id) ?? null;
    setCard(initial);
    setLoading(false);

    if (initial) {
      setSoldPrice(typeof initial.soldPrice === "number" ? String(initial.soldPrice) : "");
      setSoldDate(initial.soldDate ?? "");
      setSoldFees(typeof initial.soldFees === "number" ? String(initial.soldFees) : "");
      setSoldNotes(initial.soldNotes ?? "");
    }
  }, [id]);

  const canSave = useMemo(() => {
    const priceOk = soldPrice.trim() !== "" && Number.isFinite(Number(soldPrice));
    return Boolean(card) && priceOk;
  }, [card, soldPrice]);

  if (loading) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mark as Sold</h1>
        <p className="text-sm text-zinc-600">Loading…</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Card not found</h1>
        <p className="text-sm text-zinc-600">This card may have been deleted.</p>
        <Link
          href="/cards"
          className="inline-block rounded-md border bg-white px-4 py-2 text-sm hover:bg-zinc-50"
        >
          Back to binder
        </Link>
      </div>
    );
  }

  function onSave() {
    if (!card) return;
    if (!canSave) return;

    const now = new Date().toISOString();

    const next: SportsCard = {
      ...card,
      id: card.id,
      status: "SOLD",
      soldPrice: Number(soldPrice),
      soldDate: soldDate || now.slice(0, 10),
      soldFees: soldFees.trim() === "" ? undefined : Number(soldFees),
      soldNotes: soldNotes.trim() || undefined,
      updatedAt: now,
    };

    upsertCard(next);
    router.push("/cards/sold");
  }

  const paid = card.purchasePrice ?? 0;
  const sold = Number.isFinite(Number(soldPrice)) ? Number(soldPrice) : 0;
  const quickNet = sold - paid;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mark as Sold</h1>
          <p className="text-sm text-zinc-600">
            {card.playerName} • {card.year} • {card.setName}
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/cards/${id}`}
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Back to card
          </Link>
          <Link
            href="/cards"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Binder
          </Link>
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <Field label="Sold price *">
          <input
            value={soldPrice}
            onChange={(e) => setSoldPrice(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
            placeholder="e.g., 250"
          />
        </Field>

        <Field label="Sold date">
          <input
            value={soldDate}
            onChange={(e) => setSoldDate(e.target.value)}
            type="date"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
          />
        </Field>

        <Field label="Fees (optional)">
          <input
            value={soldFees}
            onChange={(e) => setSoldFees(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
            placeholder="e.g., 12.50"
          />
        </Field>

        <Field label="Quick net (sold - paid)">
          <div className="rounded-md border bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {currency(quickNet)}
          </div>
        </Field>

        <Field label="Sold notes (optional)" full>
          <textarea
            value={soldNotes}
            onChange={(e) => setSoldNotes(e.target.value)}
            className="min-h-[90px] w-full rounded-md border px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
            placeholder="Platform, buyer, shipping notes, etc."
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="rounded-md bg-[#2b323a] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save Sold
        </button>
        <Link
          href={`/cards/${id}`}
          className="rounded-md border bg-white px-4 py-2 text-sm hover:bg-zinc-50"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="mb-1 text-xs font-medium text-zinc-700">{label}</div>
      {children}
    </div>
  );
}
