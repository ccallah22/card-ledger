"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { cardsToCsv, downloadCsv } from "@/lib/csv";

type CardRow = {
  id: string;
  created_at: string;
  updated_at: string;

  name: string;
  sport: string | null;
  year: number | null;
  brand: string | null;
  set_name: string | null;
  series: string | null;
  card_number: string | null;
  player: string | null;
  team: string | null;

  status: string;
  quantity: number;

  condition: string | null;
  notes: string | null;

  paid_cents: number;
  asking_cents: number;
  sold_cents: number;
  fees_cents: number;

  image_path: string | null;
  thumb_path: string | null;

  thumbUrl?: string | null;
};

const STATUSES = ["All", "Have", "Want", "In Transit", "For Sale", "Sold"] as const;

function currencyFromCents(cents: number) {
  const n = (cents ?? 0) / 100;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

async function getThumbSignedUrl(path: string | null) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("card-thumbs")
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

async function fetchCardsFromSupabase(opts: {
  status: string;
  search: string;
  sport: string;
  year: string;
  team: string;
}) {
  let q = supabase.from("cards").select("*").order("created_at", { ascending: false });

  if (opts.status && opts.status !== "All") q = q.eq("status", opts.status);
  if (opts.sport) q = q.eq("sport", opts.sport);
  if (opts.team) q = q.eq("team", opts.team);
  if (opts.year) q = q.eq("year", Number(opts.year));

  if (opts.search.trim()) {
    const tsQuery = opts.search.trim().split(/\s+/).join(" & ");
    q = q.textSearch("search_tsv", tsQuery, { type: "plain" });
  }

  const res = await q;
  if (res.error) throw res.error;
  return (res.data ?? []) as CardRow[];
}

export default function CardsSupabasePage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("");
  const [year, setYear] = useState("");
  const [team, setTeam] = useState("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [signedThumbsReady, setSignedThumbsReady] = useState(false);

  const searchDebounceRef = useRef<number | null>(null);

  const totals = useMemo(() => {
    const spent = cards
      .filter((c) => (c.status ?? "") !== "Want")
      .reduce((sum, c) => sum + (c.paid_cents ?? 0), 0);

    const forSaleValue = cards
      .filter((c) => (c.status ?? "") === "For Sale")
      .reduce((sum, c) => sum + (c.asking_cents ?? 0), 0);

    const soldGross = cards
      .filter((c) => (c.status ?? "") === "Sold")
      .reduce((sum, c) => sum + (c.sold_cents ?? 0), 0);

    const soldFees = cards
      .filter((c) => (c.status ?? "") === "Sold")
      .reduce((sum, c) => sum + (c.fees_cents ?? 0), 0);

    const netSold = soldGross - soldFees;

    return { spent, forSaleValue, soldGross, soldFees, netSold };
  }, [cards]);

  const filterOptions = useMemo(() => {
    const sports = new Set<string>();
    const years = new Set<number>();
    const teams = new Set<string>();

    for (const c of cards) {
      if (c.sport) sports.add(c.sport);
      if (typeof c.year === "number") years.add(c.year);
      if (c.team) teams.add(c.team);
    }

    return {
      sports: Array.from(sports).sort(),
      years: Array.from(years).sort((a, b) => b - a),
      teams: Array.from(teams).sort(),
    };
  }, [cards]);

  async function loadCards(current: { status: string; search: string; sport: string; year: string; team: string }) {
    setLoading(true);
    setErr(null);
    setSignedThumbsReady(false);

    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        setCards([]);
        setErr("You’re not signed in. (Supabase RLS requires auth to read your cards.)");
        return;
      }

      const rows = await fetchCardsFromSupabase(current);

      const withThumbs: CardRow[] = await Promise.all(
        rows.map(async (c) => ({
          ...c,
          thumbUrl: await getThumbSignedUrl(c.thumb_path),
        }))
      );

      setCards(withThumbs);
      setSignedThumbsReady(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load cards.");
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCards({ status, search, sport, year, team });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCards({ status, search, sport, year, team });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sport, year, team]);

  useEffect(() => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = window.setTimeout(() => {
      loadCards({ status, search, sport, year, team });
    }, 300);

    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function onExportCsv() {
    try {
      const csv = cardsToCsv(
        cards.map((c) => ({
          id: c.id,
          name: c.name,
          sport: c.sport ?? "",
          year: c.year ?? "",
          brand: c.brand ?? "",
          set: c.set_name ?? "",
          series: c.series ?? "",
          cardNumber: c.card_number ?? "",
          player: c.player ?? "",
          team: c.team ?? "",
          status: c.status,
          qty: c.quantity,
          condition: c.condition ?? "",
          notes: c.notes ?? "",
          paid: (c.paid_cents ?? 0) / 100,
          asking: (c.asking_cents ?? 0) / 100,
          sold: (c.sold_cents ?? 0) / 100,
          fees: (c.fees_cents ?? 0) / 100,
          imagePath: c.image_path ?? "",
          thumbPath: c.thumb_path ?? "",
        })) as any
      );
      downloadCsv(csv, `cards-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      const header = [
        "name",
        "player",
        "team",
        "year",
        "brand",
        "set_name",
        "status",
        "paid_cents",
        "asking_cents",
      ].join(",");
      const lines = cards.map((c) =>
        [
          c.name ?? "",
          c.player ?? "",
          c.team ?? "",
          c.year ?? "",
          c.brand ?? "",
          c.set_name ?? "",
          c.status ?? "",
          c.paid_cents ?? 0,
          c.asking_cents ?? 0,
        ]
          .map((x) => `"${String(x).replaceAll('"', '""')}"`)
          .join(",")
      );
      const csv = [header, ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cards-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cards</h1>
          <p className="text-sm text-neutral-500">Search, filter, and manage your collection.</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onExportCsv} className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50">
            Export CSV
          </button>

          <Link href="/add" className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800">
            Add Card
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-neutral-500">Total Spent</div>
          <div className="mt-1 font-semibold">{currencyFromCents(totals.spent)}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-neutral-500">For Sale Value</div>
          <div className="mt-1 font-semibold">{currencyFromCents(totals.forSaleValue)}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-neutral-500">Sold Gross</div>
          <div className="mt-1 font-semibold">{currencyFromCents(totals.soldGross)}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-neutral-500">Sold Fees</div>
          <div className="mt-1 font-semibold">{currencyFromCents(totals.soldFees)}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-neutral-500">Net Sold</div>
          <div className="mt-1 font-semibold">{currencyFromCents(totals.netSold)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const active = s === status;
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                active
                  ? "rounded-full bg-neutral-900 px-3 py-1.5 text-sm text-white"
                  : "rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search (player, team, brand, set, #...)"
          className="rounded-md border px-3 py-2 text-sm"
        />

        <select value={sport} onChange={(e) => setSport(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
          <option value="">All sports</option>
          {filterOptions.sports.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
          <option value="">All years</option>
          {filterOptions.years.map((v) => (
            <option key={v} value={String(v)}>
              {v}
            </option>
          ))}
        </select>

        <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
          <option value="">All teams</option>
          {filterOptions.teams.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="w-14 px-3 py-2">Img</th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Asking</th>
            </tr>
          </thead>

          <tbody>
            {err ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-sm text-red-600">
                  {err}
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-sm text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : cards.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-sm text-neutral-500">
                  No cards found.
                </td>
              </tr>
            ) : (
              cards.map((c) => (
                <tr key={c.id} className="border-t hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    {signedThumbsReady && c.thumbUrl ? (
                      <img src={c.thumbUrl} alt="" className="h-10 w-10 rounded border object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded border bg-neutral-100" />
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <Link href={`/cards/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {c.brand ?? ""}{c.set_name ? ` • ${c.set_name}` : ""}{c.card_number ? ` • #${c.card_number}` : ""}
                      {c.series ? ` • ${c.series}` : ""}
                    </div>
                  </td>

                  <td className="px-3 py-2">{c.player ?? "—"}</td>
                  <td className="px-3 py-2">{c.team ?? "—"}</td>
                  <td className="px-3 py-2">{c.year ?? "—"}</td>

                  <td className="px-3 py-2">
                    <span className="rounded-full border px-2 py-1 text-xs">{c.status}</span>
                  </td>

                  <td className="px-3 py-2 text-right">{currencyFromCents(c.paid_cents ?? 0)}</td>
                  <td className="px-3 py-2 text-right">{currencyFromCents(c.asking_cents ?? 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
