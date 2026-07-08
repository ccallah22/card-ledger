import type { ReactNode } from "react";

export type StatCardProps = {
  title: ReactNode;
  value?: ReactNode;
  subtitle?: ReactNode;
};

export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-zinc-500">{title}</div>
      {value !== undefined ? (
        <div className="mt-1 text-2xl font-semibold text-zinc-900">{value}</div>
      ) : null}
      {subtitle !== undefined ? (
        <div className="mt-1 text-sm text-zinc-600">{subtitle}</div>
      ) : null}
    </div>
  );
}
