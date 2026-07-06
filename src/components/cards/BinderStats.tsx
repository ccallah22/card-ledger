import { Stat } from "@/components/cards/BinderUi";

type BinderTotals = {
  totalCards: number;
  totalSpent: number;
  totalPortfolioValue: number;
  totalNetGain: number;
};

export function BinderStats({
  totals,
  netTone,
}: {
  totals: BinderTotals;
  netTone: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Stat label="Total cards" value={`${totals.totalCards}`} />
      <Stat label="Total spent" value={currency(totals.totalSpent)} />
      <Stat label="Portfolio value" value={currency(totals.totalPortfolioValue)} />
      <Stat
        label="Total net gain"
        value={currency(totals.totalNetGain, { accounting: true })}
        tone={netTone}
      />
    </div>
  );
}

function currency(n: number, opts?: { accounting?: boolean }) {
  const accounting = opts?.accounting ?? false;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });

  if (n < 0 && accounting) return `(${formatted})`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}
