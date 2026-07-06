"use client";

import { useState } from "react";
import { players } from "@/lib/players";
import { PlayerCard } from "@/components/players/PlayerCard";

export function PlayerExplorer() {
  const [search, setSearch] = useState("");

  const filteredPlayers = players.filter((player) => {
    const query = search.toLowerCase();

    return (
      player.name.toLowerCase().includes(query) ||
      player.sport.toLowerCase().includes(query) ||
      player.team.toLowerCase().includes(query)
    );
  });

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
        {filteredPlayers.length === 0 && (
          <p className="text-sm text-muted-foreground">No players found.</p>
        )}

        {filteredPlayers.map((player) => (
          <PlayerCard
  key={player.id}
  player={player}
/>
        ))}
      </div>
    </div>
  );
}

