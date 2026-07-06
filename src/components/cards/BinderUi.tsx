import type { ReactNode } from "react";

type StatTone = "neutral" | "positive" | "negative";

export function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: StatTone;
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
      ? "text-red-700"
      : "text-zinc-900";

  const borderClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "negative"
      ? "border-red-200 bg-red-50"
      : "border-zinc-200 bg-white";

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

export function Tab({
  active,
  onClick,
  children,
  variant = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  variant?: "default" | "football" | "soccer";
}) {
  const base =
    "inline-flex whitespace-nowrap items-center rounded-full px-3 py-2 text-sm font-semibold transition";

  const cls =
    variant === "football"
      ? active
        ? "border border-[#4a2a14] bg-[#7a3f22] text-[#fff3e1] shadow-[0_0_0_1px_rgba(210,164,108,0.55)]"
        : "border border-[#5a2f18] bg-[#8b4a2b] text-[#fff3e1] hover:bg-[#7f4226]"
      : variant === "soccer"
      ? active
        ? "border border-zinc-900 bg-white text-black shadow-[0_0_0_1px_rgba(24,24,27,0.35)]"
        : "border border-zinc-900 bg-white text-black hover:bg-zinc-50"
      : active
      ? "bg-[var(--brand-primary)] text-white"
      : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200";

  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex whitespace-nowrap items-center rounded-full border px-3 py-1 text-xs font-medium transition " +
        (active
          ? "border-zinc-900 bg-[var(--brand-primary)] text-white"
          : "border-zinc-400 bg-white text-zinc-800 hover:bg-zinc-50")
      }
    >
      {children}
    </button>
  );
}

export type BadgeTone =
  | "zinc"
  | "blue"
  | "dots-blue"
  | "purple"
  | "amber"
  | "red"
  | "green"
  | "orange"
  | "yellow"
  | "pink"
  | "teal"
  | "black"
  | "white"
  | "silver"
  | "gold"
  | "lava";

export function MiniBadge({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const isDotsBlue = tone === "dots-blue";

  const cls =
    tone === "dots-blue"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : tone === "blue"
      ? "border-zinc-300 bg-zinc-100 text-zinc-200"
      : tone === "purple"
      ? "border-purple-200 bg-purple-50 text-purple-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "orange"
      ? "border-orange-200 bg-orange-50 text-orange-700"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-800"
      : tone === "pink"
      ? "border-pink-200 bg-pink-50 text-pink-700"
      : tone === "teal"
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : tone === "lava"
      ? "border-orange-300 bg-orange-100 text-red-700"
      : tone === "black"
      ? "border-zinc-800 bg-[var(--brand-primary)] text-white"
      : tone === "white"
      ? "border-zinc-200 bg-white text-zinc-900"
      : tone === "silver"
      ? "border-zinc-200 bg-zinc-100 text-zinc-800"
      : tone === "gold"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-zinc-200 bg-white text-zinc-700";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}
      style={
        isDotsBlue
          ? {
              backgroundImage:
                "radial-gradient(rgba(59,130,246,0.22) 1px, transparent 1px)",
              backgroundSize: "7px 7px",
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function IconDots() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6.5" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="17.5" r="1.3" />
    </svg>
  );
}
