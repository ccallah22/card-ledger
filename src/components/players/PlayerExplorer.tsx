"use client";

import { useEffect, useState } from "react";
import {
  listPlayers,
  searchPlayers,
  type PlayerFilters,
  type PlayerWithContext,
} from "@/lib/repositories/players";
import { listSports, type SportRow } from "@/lib/repositories/sports";
import { listLeagues, type LeagueRow } from "@/lib/repositories/leagues";
import { listTeams, type TeamRow } from "@/lib/repositories/teams";
import { PlayerCard } from "@/components/players/PlayerCard";

export function PlayerExplorer() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [players, setPlayers] = useState<PlayerWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sports, setSports] = useState<SportRow[]>([]);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [sportId, setSportId] = useState<number | undefined>(undefined);
  const [leagueId, setLeagueId] = useState<number | undefined>(undefined);
  const [teamId, setTeamId] = useState<number | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // Load the sport dropdown once.
  useEffect(() => {
    listSports()
      .then(setSports)
      .catch(() => setSports([]));
  }, []);

  // Load leagues for the selected sport (cascading).
  useEffect(() => {
    if (!sportId) {
      setLeagues([]);
      return;
    }
    listLeagues(sportId)
      .then(setLeagues)
      .catch(() => setLeagues([]));
  }, [sportId]);

  // Load teams for the selected league (cascading).
  useEffect(() => {
    if (!leagueId) {
      setTeams([]);
      return;
    }
    listTeams(leagueId)
      .then(setTeams)
      .catch(() => setTeams([]));
  }, [leagueId]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        setError("");
        const filters: PlayerFilters = { sportId, leagueId, teamId };
        const data = debouncedSearch.trim()
          ? await searchPlayers(debouncedSearch.trim(), filters)
          : await listPlayers(filters);
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
  }, [debouncedSearch, sportId, leagueId, teamId]);

  function handleSportChange(value: string) {
    setSportId(value ? Number(value) : undefined);
    setLeagueId(undefined);
    setTeamId(undefined);
  }

  function handleLeagueChange(value: string) {
    setLeagueId(value ? Number(value) : undefined);
    setTeamId(undefined);
  }

  function handleTeamChange(value: string) {
    setTeamId(value ? Number(value) : undefined);
  }

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

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <select
          value={sportId ?? ""}
          onChange={(event) => handleSportChange(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All sports</option>
          {sports.map((sport) => (
            <option key={sport.id} value={sport.id}>
              {sport.name}
            </option>
          ))}
        </select>

        <select
          value={leagueId ?? ""}
          onChange={(event) => handleLeagueChange(event.target.value)}
          disabled={!sportId}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">All leagues</option>
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <select
          value={teamId ?? ""}
          onChange={(event) => handleTeamChange(event.target.value)}
          disabled={!leagueId}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

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
