"use client";

import { useEffect, useState } from "react";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const isDate = type === "date";
  const inputClass =
    "mt-1 w-full min-w-0 max-w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400";

  const [dateDisplay, setDateDisplay] = useState("");

  useEffect(() => {
    if (!isDate) return;
    if (!value) {
      setDateDisplay("");
      return;
    }
    const parts = value.split("-");
    if (parts.length === 3) {
      setDateDisplay(`${parts[1]}/${parts[2]}/${parts[0]}`);
      return;
    }
    setDateDisplay(value);
  }, [isDate, value]);

  function parseDateInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!match) return null;
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return (
    <div className="min-w-0 w-full">
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <div className={isDate ? "relative" : ""}>
        {isDate ? (
          <>
            <input
              value={dateDisplay}
              onChange={(e) => {
                const nextDisplay = e.target.value;
                setDateDisplay(nextDisplay);
                const parsed = parseDateInput(nextDisplay);
                if (parsed === "") onChange("");
                else if (parsed) onChange(parsed);
              }}
              placeholder="mm/dd/yyyy"
              inputMode="numeric"
              className={inputClass + " pr-10"}
            />
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              type="date"
              className="absolute inset-0 opacity-0"
              onClick={(e) => {
                const el = e.currentTarget;
                if (typeof (el as HTMLInputElement).showPicker === "function") {
                  (el as HTMLInputElement).showPicker();
                }
              }}
            />
          </>
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            type={type}
            className={inputClass}
          />
        )}
        {isDate ? (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm text-zinc-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-zinc-900"
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}
