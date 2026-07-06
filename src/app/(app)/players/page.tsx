import { PlayerExplorer } from "@/components/players/PlayerExplorer";

export default function PlayersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Player Explorer</h1>
        <p className="text-muted-foreground">
          Search players, teams, sports, and future card connections.
        </p>
      </div>

      <PlayerExplorer />
    </div>
  );
}

