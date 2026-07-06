"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayerBySlug, type PlayerWithContext } from "@/lib/repositories/players";
import { listCardsForPlayer, type CardForPlayer } from "@/lib/repositories/cardPlayers";
import { listMyCardsForPlayer, type MyCard } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";

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

  const [myCards, setMyCards] = useState<MyCard[]>([]);
  const [myCardsLoading, setMyCardsLoading] = useState(true);

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

  useEffect(() => {
    if (!player) return;
    let active = true;

    (async () => {
      try {
        setMyCardsLoading(true);
        const profile = await getCurrentProfile();
        if (!profile) {
          if (active) setMyCards([]);
          return;
        }
        const found = await listMyCardsForPlayer(profile.id, player.id);
        if (active) setMyCards(found);
      } finally {
        if (active) setMyCardsLoading(false);
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Catalog cards</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{cards.length}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">My cards</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{myCards.length}</div>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">My Cards Featuring This Player</h2>

        {myCardsLoading ? (
          <div className="loading-state">Loading your cards…</div>
        ) : myCards.length === 0 ? (
          <div className="empty-state">You don't own any cards featuring this player yet.</div>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {myCards.map((card) => {
              const primaryParts = [
                card.year,
                card.setName,
                card.cardNumber ? `#${card.cardNumber}` : null,
                card.insert,
              ].filter(Boolean);
              const secondaryParts = [card.status, card.condition, card.location].filter(Boolean);

              return (
                <li key={card.id}>
                  <Link
                    href={`/cards/${card.id}`}
                    className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <div>{primaryParts.join(" • ")}</div>
                    {secondaryParts.length > 0 ? (
                      <div className="text-xs text-zinc-500">{secondaryParts.join(" • ")}</div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
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
