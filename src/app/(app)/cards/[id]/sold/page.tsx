"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { dbGetCard, dbUpsertCard } from "@/lib/db/cards";

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
  const [soldNotes, setSoldNotes] = useState<string>("");
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const initial = await dbGetCard(String(id));
      if (!active) return;
      setCard(initial);
      setLoading(false);

      if (initial) {
        setSoldPrice(typeof initial.soldPrice === "number" ? String(initial.soldPrice) : "");
        setSoldDate(initial.soldDate ?? "");
        setSoldNotes(initial.soldNotes ?? "");
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const value = params.get("return");
    setReturnTo(value);
  }, []);

  const canSave = useMemo(() => {
    const priceOk = soldPrice.trim() !== "" && Number.isFinite(Number(soldPrice));
    return Boolean(card) && priceOk;
  }, [card, soldPrice]);

  if (loading) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mark as Sold</h1>
        <div className="loading-state">Loading card details…</div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="error-state space-y-2">
        <div className="text-base font-semibold">Card not found</div>
        <div className="text-sm text-zinc-600">This card may have been deleted.</div>
        <Link href="/cards" className="btn-link">
          Back to Binder
        </Link>
      </div>
    );
  }

  async function onSave() {
    if (!card) return;
    if (!canSave) return;
    setIsSaving(true);
    try {

    const now = new Date().toISOString();

    const next: SportsCard = {
      ...card,
      id: card.id,
      status: "SOLD",
      soldPrice: Number(soldPrice),
      soldDate: soldDate || now.slice(0, 10),
      soldNotes: soldNotes.trim() || undefined,
      updatedAt: now,
    };

      await dbUpsertCard(next);
      router.push(returnTo === "for-sale" ? "/cards/for-sale" : "/cards/sold");
    } finally {
      setIsSaving(false);
    }
  }

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
          {returnTo === "for-sale" ? (
            <Link href="/cards/for-sale" className="btn-secondary">
              Return to For Sale
            </Link>
          ) : (
            <>
              <Link href={`/cards/${id}`} className="btn-secondary">
                Back to card
              </Link>
              <Link href="/cards" className="btn-secondary">
                Binder
              </Link>
            </>
          )}
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
            onClick={(e) => {
              const el = e.currentTarget;
              if (typeof (el as HTMLInputElement).showPicker === "function") {
                (el as HTMLInputElement).showPicker();
              }
            }}
          />
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
          disabled={!canSave || isSaving}
          className="btn-primary"
        >
          {isSaving ? "Saving…" : "Save Sold"}
        </button>
        {returnTo === "for-sale" ? (
          <Link href="/cards/for-sale" className="btn-secondary">
            Return to For Sale
          </Link>
        ) : (
          <Link href={`/cards/${id}`} className="btn-secondary">
            Cancel
          </Link>
        )}
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
