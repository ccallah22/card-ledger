export type FingerprintInput = {
  year?: string;
  setName?: string;
  cardNumber?: string;
  playerName?: string;
  team?: string;
  insert?: string;
  variation?: string;
  parallel?: string;
  subset?: string;
};

function norm(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

export function buildCardFingerprint(input: FingerprintInput) {
  const parts = [
    norm(input.year),
    norm(input.setName),
    norm(input.subset),
    input.cardNumber ? `#${norm(input.cardNumber)}` : "",
    norm(input.playerName),
    norm(input.team),
    input.insert ? `insert:${norm(input.insert)}` : "",
    input.variation ? `variation:${norm(input.variation)}` : "",
    input.parallel ? `parallel:${norm(input.parallel)}` : "",
  ].filter(Boolean);

  return parts.join("|");
}
