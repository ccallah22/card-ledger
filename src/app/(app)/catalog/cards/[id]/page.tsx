"use client";

import { use, useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { getCardWithContext, type CardWithContext } from "@/lib/repositories/cards";

export default function CatalogCardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<CardWithContext | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        const numericId = Number(id);
        const found = Number.isFinite(numericId) ? await getCardWithContext(numericId) : null;
        if (!active) return;
        if (!found) {
          setMissing(true);
          return;
        }
        setCard(found);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  if (missing) {
    notFound();
  }

  if (loading) {
    return <div className="loading-state">Loading card…</div>;
  }

  if (!card) {
    return null;
  }

  const subtitleParts = [card.releaseYear, card.setName].filter(Boolean);

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        {card.title || `Card #${card.cardNumber}`}
      </h1>
      {subtitleParts.length > 0 ? (
        <p className="text-sm text-zinc-600">{subtitleParts.join(" • ")}</p>
      ) : null}

      <div className="mt-4 space-y-1 text-sm text-zinc-700">
        <div>Card #: {card.cardNumber}</div>
        {card.setBrand ? <div>Brand: {card.setBrand}</div> : null}
        {card.setManufacturer ? <div>Manufacturer: {card.setManufacturer}</div> : null}
        {card.playerNames.length > 0 ? (
          <div>Players: {card.playerNames.join(", ")}</div>
        ) : null}
        {card.rookieCard ? <div>Rookie Card</div> : null}
        {card.isInsert ? <div>Insert</div> : null}
        {card.isAutograph ? <div>Autograph</div> : null}
        {card.isMemorabilia ? <div>Memorabilia</div> : null}
      </div>
    </div>
  );
}
