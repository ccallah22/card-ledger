import type { Player } from "@/types/player";

type PlayerCardProps = {
  player: Player;
};

export function PlayerCard({ player }: PlayerCardProps) {
  return (
    <div className="rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <h3 className="font-semibold">{player.name}</h3>
      <p className="text-sm text-muted-foreground">
        {player.sport} • {player.team}
      </p>
    </div>
  );
}

