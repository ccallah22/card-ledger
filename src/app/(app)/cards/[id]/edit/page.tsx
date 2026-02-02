"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SportsCard, CardCondition, CardStatus } from "@/lib/types";
import { loadCards, upsertCard } from "@/lib/storage";
import { loadImageForCard, removeImageForCard } from "@/lib/imageStore";
import { IMAGE_RULES, processImageFile } from "@/lib/image";
import { formatCurrency } from "@/lib/format";

function toNum(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;

  // allow commas/spaces people sometimes type
  const cleaned = t.replace(/,/g, "").replace(/\s/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export default function EditCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [original, setOriginal] = useState<SportsCard | null>(null);

  // Core
  const [playerName, setPlayerName] = useState("");
  const [year, setYear] = useState("");
  const [setName, setSetName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [team, setTeam] = useState("");

  // Location
  const [location, setLocation] = useState("");

  // Condition / grading
  const [condition, setCondition] = useState<CardCondition>("RAW");
  const [grader, setGrader] = useState("");
  const [grade, setGrade] = useState("");

  // Status / purchase
  const [status, setStatus] = useState<CardStatus>("HAVE");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState<string>("");

  // Collector fields
  const [variation, setVariation] = useState("");
  const [insert, setInsert] = useState("");
  const [parallel, setParallel] = useState("");
  const [serialNumber, setSerialNumber] = useState<string>("");
  const [serialTotal, setSerialTotal] = useState<string>("");

  const [isRookie, setIsRookie] = useState(false);
  const [isAutograph, setIsAutograph] = useState(false);
  const [isPatch, setIsPatch] = useState(false);

  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [imageRemoved, setImageRemoved] = useState(false);

  useEffect(() => {
    const cards = loadCards();
    const found = cards.find((c) => String(c.id) === String(id)) ?? null;

    if (!found) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setOriginal(found);

    setPlayerName(found.playerName ?? "");
    setYear(found.year ?? "");
    setSetName(found.setName ?? "");
    setCardNumber(found.cardNumber ?? "");
    setTeam(found.team ?? "");

    setLocation((found as any).location ?? "");

    setCondition(found.condition ?? "RAW");
    setGrader(found.grader ?? "");
    setGrade(found.grade ?? "");

    setStatus(found.status ?? "HAVE");
    setPurchasePrice(typeof found.purchasePrice === "number" ? String(found.purchasePrice) : "");
    setPurchaseDate(found.purchaseDate ?? "");

    setVariation((found as any).variation ?? "");
    setInsert((found as any).insert ?? "");
    setParallel((found as any).parallel ?? "");

    setSerialNumber(
      typeof (found as any).serialNumber === "number" ? String((found as any).serialNumber) : ""
    );
    setSerialTotal(
      typeof (found as any).serialTotal === "number" ? String((found as any).serialTotal) : ""
    );

    setIsRookie(!!(found as any).isRookie);
    setIsAutograph(!!(found as any).isAutograph);
    setIsPatch(!!(found as any).isPatch);

    setNotes(found.notes ?? "");
    setImageUrl(loadImageForCard(String(found.id)));
    setImageRemoved(false);

    setLoading(false);
  }, [id]);

  const canSave = useMemo(() => {
    return Boolean(playerName.trim() && year.trim() && setName.trim());
  }, [playerName, year, setName]);

  // ✅ Currency preview for Paid input
  const paidPreview = useMemo(() => {
    const n = toNum(purchasePrice);
    if (typeof n !== "number") return null;
    return formatCurrency(n);
  }, [purchasePrice]);

  function onSave() {
    if (!original) return;
    if (!canSave) return;

    const now = new Date().toISOString();

    const next: SportsCard = {
      ...original,

      playerName: playerName.trim(),
      year: year.trim(),
      setName: setName.trim(),
      cardNumber: cardNumber.trim() || undefined,
      team: team.trim() || undefined,

      location: location.trim() || undefined,

      condition,
      grader: condition === "GRADED" ? (grader.trim() || undefined) : undefined,
      grade: condition === "GRADED" ? (grade.trim() || undefined) : undefined,

      status,

      purchasePrice: toNum(purchasePrice),
      purchaseDate: purchaseDate || undefined,

      variation: variation.trim() || undefined,
      insert: insert.trim() || undefined,
      parallel: parallel.trim() || undefined,
      serialNumber: toNum(serialNumber),
      serialTotal: toNum(serialTotal),

      isRookie: isRookie || undefined,
      isAutograph: isAutograph || undefined,
      isPatch: isPatch || undefined,

      notes: notes.trim() || undefined,
      imageUrl: imageUrl || undefined,
      imageShared: imageUrl ? (original as any).imageShared : undefined,

      updatedAt: now,
      createdAt: original.createdAt ?? now,
    };

    if (imageRemoved) {
      removeImageForCard(String(original.id));
      next.imageUrl = undefined;
      next.imageShared = undefined;
    }

    upsertCard(next);
    router.push(`/cards/${original.id}`);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  if (notFound) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">Card not found</h1>
        <div className="text-xs text-gray-500">
          ID in URL: <span className="font-mono">{String(id)}</span>
        </div>
        <Link href="/cards" className="text-zinc-300 underline">
          Back to binder
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit Card</h1>
          <p className="text-sm text-zinc-600">Update details for this card.</p>
        </div>
        <Link
          href={`/cards/${String(id)}`}
          className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
        >
          Back
        </Link>
      </div>

      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <Field label="Player" value={playerName} onChange={setPlayerName} placeholder="Baker Mayfield" />
        <Field label="Year" value={year} onChange={setYear} placeholder="2018" />
        <Field label="Set" value={setName} onChange={setSetName} placeholder="Panini Score" />
        <Field label="Card #" value={cardNumber} onChange={setCardNumber} placeholder="123" />
        <Field label="Team" value={team} onChange={setTeam} placeholder="Browns" />
        <Field label="Location" value={location} onChange={setLocation} placeholder="Binder A / Box 1 / Safe" />

        <Select
          label="Condition"
          value={condition}
          onChange={(v) => setCondition(v as CardCondition)}
          options={[
            ["RAW", "Raw"],
            ["GRADED", "Graded"],
          ]}
        />

        {/* ✅ No placeholders here (prevents weird empty grid gaps) */}
        {condition === "GRADED" ? (
          <>
            <Field label="Grader" value={grader} onChange={setGrader} placeholder="PSA" />
            <Field label="Grade" value={grade} onChange={setGrade} placeholder="10" />
          </>
        ) : null}

        <Select
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as CardStatus)}
          options={[
            ["HAVE", "Have"],
            ["WANT", "Want"],
            ["FOR_SALE", "For Sale"],
            ["SOLD", "Sold"],
          ]}
        />

        {/* ✅ Paid is now a single grid item (no nested Field) */}
        <MoneyField
          label="Paid"
          value={purchasePrice}
          onChange={setPurchasePrice}
          placeholder="50"
          preview={paidPreview}
        />

        <Field label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} type="date" />

        <div className="sm:col-span-2 mt-2 border-t pt-4">
          <div className="text-sm font-medium text-zinc-900">Variations / Parallels</div>
          <div className="text-xs text-zinc-500">
            Examples: Base, Silver, Refractor, X-Fractor, Wave, Pink, /99, etc.
          </div>
        </div>

        <Field label="Variation" value={variation} onChange={setVariation} placeholder="Refractor" />
        <Field label="Insert" value={insert} onChange={setInsert} placeholder="Kaboom" />
        <Field label="Parallel" value={parallel} onChange={setParallel} placeholder="Pink Wave" />

        <Field label="Serial #" value={serialNumber} onChange={setSerialNumber} placeholder="12" />
        <Field label="Serial total" value={serialTotal} onChange={setSerialTotal} placeholder="99" />

        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
          <Check label="Rookie" checked={isRookie} onChange={setIsRookie} />
          <Check label="Autograph" checked={isAutograph} onChange={setIsAutograph} />
          <Check label="Patch/Relic" checked={isPatch} onChange={setIsPatch} />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-zinc-600">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
            rows={3}
            placeholder="Any extra details…"
          />
        </div>

        <div className="sm:col-span-2 mt-2 border-t pt-4">
          <div className="text-sm font-medium text-zinc-900">Card image</div>
          <div className="text-xs text-zinc-500">Upload a new image or remove the current one.</div>
        </div>

        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-[180px_1fr] items-start">
          <div className="h-40 w-full rounded-md border bg-zinc-50 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt="Card" className="h-full w-full object-cover" />
            ) : (
              <div className="text-xs text-zinc-400">No image</div>
            )}
          </div>
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
              <input
                type="file"
                accept={IMAGE_RULES.allowedTypes.join(",")}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setImageError("");
                  try {
                    const { dataUrl } = await processImageFile(file);
                    setImageUrl(dataUrl);
                    setImageRemoved(false);
                  } catch (err) {
                    setImageError((err as Error).message || "Image failed validation.");
                  }
                }}
              />
              Upload image
            </label>
            {imageUrl ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(null);
                  setImageRemoved(true);
                }}
                className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Remove image
              </button>
            ) : null}
            {imageError ? <div className="text-xs text-red-600">{imageError}</div> : null}
          </div>
        </div>

        <div className="sm:col-span-2 flex justify-end gap-2">
          <Link
            href={`/cards/${String(id)}`}
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Cancel
          </Link>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- UI components ---------- */

function Field({
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
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
        onClick={(e) => {
          if (!isDate) return;
          const el = e.currentTarget;
          if (typeof (el as HTMLInputElement).showPicker === "function") {
            (el as HTMLInputElement).showPicker();
          }
        }}
      />
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder,
  preview,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  preview: string | null;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
      />
      <div className="mt-1 text-xs text-zinc-500">{preview ? `Preview: ${preview}` : "Preview: —"}</div>
    </div>
  );
}

function Select({
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
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
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

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
