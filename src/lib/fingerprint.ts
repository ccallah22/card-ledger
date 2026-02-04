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
  serialTotal?: string | number;
};

function norm(value?: string | number) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

function normalizeParallel(parallel?: string) {
  const raw = norm(parallel);
  const serialMatch = raw.match(/\/\s*(\d+)\b/);
  const cleaned = raw.replace(/\/\s*\d+\b/g, "").replace(/\s+/g, " ").trim();
  return {
    cleaned,
    serialFromParallel: serialMatch ? serialMatch[1] : "",
  };
}

function normalizeSerialTotal(value?: string | number) {
  const raw = norm(value);
  if (!raw) return "";
  const match = raw.match(/\d+/);
  return match ? match[0] : "";
}

export function buildCardFingerprint(input: FingerprintInput) {
  const parallel = normalizeParallel(input.parallel);
  const serialTotal = normalizeSerialTotal(input.serialTotal || parallel.serialFromParallel);

  const parts = [
    norm(input.year),
    norm(input.setName),
    norm(input.subset),
    input.cardNumber ? `#${norm(input.cardNumber)}` : "",
    norm(input.playerName),
    norm(input.team),
    input.insert ? `insert:${norm(input.insert)}` : "",
    input.variation ? `variation:${norm(input.variation)}` : "",
    parallel.cleaned ? `parallel:${parallel.cleaned}` : "",
    serialTotal ? `serial_total:${serialTotal}` : "",
  ].filter(Boolean);

  return parts.join("|");
}
