import { confidenceBucket, confidenceBucketLabel, type ConfidenceBucket } from "@/lib/evidence/formatEvidence";

// Vision Engine V3, Phase V3.3A: always a High/Medium/Low bucket label --
// never a raw number or percentage, matching the same bucketing scheme
// established for vision observation confidence.
const CONFIDENCE_STYLES: Record<ConfidenceBucket, string> = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-zinc-100 text-zinc-500",
};

export function EvidenceConfidenceBadge({ confidence }: { confidence: number }) {
  const bucket = confidenceBucket(confidence);
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLES[bucket]}`}>
      {confidenceBucketLabel(bucket)}
    </span>
  );
}
