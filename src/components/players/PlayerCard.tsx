import Link from "next/link";
import type { PlayerWithContext } from "@/lib/repositories/players";

type PlayerCardProps = {
  player: PlayerWithContext;
};

export function PlayerCard({ player }: PlayerCardProps) {
  const contextParts = [player.team_name, player.league_name, player.sport_name].filter(
    (part): part is string => !!part,
  );

  return (
    <Link
      href={`/players/${player.slug}`}
      className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <h3 className="font-semibold">{player.full_name}</h3>
      {contextParts.length > 0 ? (
        <p className="text-sm text-muted-foreground">{contextParts.join(" • ")}</p>
      ) : null}
    </Link>
  );
}
