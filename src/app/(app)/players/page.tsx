import { PlayerExplorer } from "@/components/players/PlayerExplorer";
import { PageHeader } from "@/components/ui/PageHeader";

export default function PlayersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Player Explorer"
        subtitle="Search players, teams, sports, and future card connections."
      />

      <PlayerExplorer />
    </div>
  );
}

