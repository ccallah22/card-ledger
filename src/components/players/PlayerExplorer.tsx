"use client";

import { useEffect, useState } from "react";
import { listPlayers, searchPlayers, type PlayerWithContext } from "@/lib/repositories/players";
import { PlayerCard } from "@/components/players/PlayerCard";

export function PlayerExplorer() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [players, setPlayers] = useState<PlayerWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = debouncedSearch.trim()
          ? await searchPlayers(debouncedSearch.trim())
          : await listPlayers();
        if (active) setPlayers(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load players.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Search Players</h2>
        <p className="text-sm text-muted-foreground">
          Start typing a player name to find matching athletes.
        </p>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Search by player name..."
      />

      <p className="mt-4 text-sm text-muted-foreground">
        Current search: {search || "Nothing typed yet"}
      </p>

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading players…</p>
        ) : error ? (
          <p className="text-sm text-red-600">Could not load players. {error}</p>
        ) : players.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players found.</p>
        ) : (
          players.map((player) => <PlayerCard key={player.id} player={player} />)
        )}
      </div>
    </div>
  );
}
