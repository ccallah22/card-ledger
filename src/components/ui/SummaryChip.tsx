export type SummaryChipProps = {
  label: string;
  value: string | number;
};

export function SummaryChip({ label, value }: SummaryChipProps) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold text-zinc-900">{value}</span>
    </div>
  );
}
