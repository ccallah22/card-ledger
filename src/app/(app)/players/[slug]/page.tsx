"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayerBySlug, type PlayerWithContext } from "@/lib/repositories/players";
import { listCardsForPlayer, type CardForPlayer } from "@/lib/repositories/cardPlayers";

export default function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState<PlayerWithContext | null>(null);
  const [missing, setMissing] = useState(false);

  const [cards, setCards] = useState<CardForPlayer[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        const found = await getPlayerBySlug(slug);
        if (!active) return;
        if (!found) {
          setMissing(true);
          return;
        }
        setPlayer(found);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!player) return;
    let active = true;

    (async () => {
      try {
        setCardsLoading(true);
        const found = await listCardsForPlayer(player.id);
        if (active) setCards(found);
      } finally {
        if (active) setCardsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [player]);

  if (missing) {
    notFound();
  }

  if (loading) {
    return <div className="loading-state">Loading player…</div>;
  }

  if (!player) {
    return null;
  }

  const contextParts = [player.team_name, player.league_name, player.sport_name].filter(
    (part): part is string => !!part,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{player.full_name}</h1>
        {contextParts.length > 0 ? (
          <p className="text-sm text-zinc-600">{contextParts.join(" • ")}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Cards Featuring This Player</h2>

        {cardsLoading ? (
          <div className="loading-state">Loading cards…</div>
        ) : cards.length === 0 ? (
          <div className="empty-state">No cards found for this player yet.</div>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {cards.map((card) => (
              <li key={card.cardId}>
                <Link
                  href={`/catalog/cards/${card.cardId}`}
                  className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  {[
                    card.releaseYear,
                    card.setName,
                    card.cardNumber ? `#${card.cardNumber}` : null,
                    card.title,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
