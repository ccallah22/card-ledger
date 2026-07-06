import Link from "next/link";

import { Chip, Tab } from "@/components/cards/BinderUi";

type SortMode =
  | "PLAYER_ASC"
  | "YEAR_DESC"
  | "SET_ASC"
  | "TEAM_ASC"
  | "EST_VALUE_DESC";

type FilterOption = {
  key: string;
  label: string;
  count: number;
};

type DuplicateInfo = {
  dupCardsCount: number;
};

export function BinderToolbar({
  sportFilter,
  sportOptions,
  q,
  sortMode,
  showFilters,
  activeFiltersCount,
  locationOptions,
  insertOptions,
  parallelOptions,
  numberedOptions,
  locationKey,
  insertKey,
  parallelKey,
  numberedKey,
  dupOnly,
  autoOnly,
  patchOnly,
  rookieOnly,
  dupInfo,
  setSportAndReset,
  setQ,
  setSortMode,
  setShowFilters,
  setLocationKey,
  setInsertKey,
  setParallelKey,
  setNumberedKey,
  setDupOnly,
  setAutoOnly,
  setPatchOnly,
  setRookieOnly,
  clearCollectorFilters,
  clearAllFilters,
}: {
  sportFilter: string;
  sportOptions: FilterOption[];
  q: string;
  sortMode: SortMode;
  showFilters: boolean;
  activeFiltersCount: number;
  locationOptions: FilterOption[];
  insertOptions: FilterOption[];
  parallelOptions: FilterOption[];
  numberedOptions: FilterOption[];
  locationKey: string;
  insertKey: string;
  parallelKey: string;
  numberedKey: string;
  dupOnly: boolean;
  autoOnly: boolean;
  patchOnly: boolean;
  rookieOnly: boolean;
  dupInfo: DuplicateInfo;
  setSportAndReset: (next: string) => void;
  setQ: (next: string) => void;
  setSortMode: (next: SortMode) => void;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  setLocationKey: (next: string) => void;
  setInsertKey: (next: string) => void;
  setParallelKey: (next: string) => void;
  setNumberedKey: (next: string) => void;
  setDupOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setPatchOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setRookieOnly: React.Dispatch<React.SetStateAction<boolean>>;
  clearCollectorFilters: () => void;
  clearAllFilters: () => void;
}) {
  return (
    <div className="rounded-xl border bg-white p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="w-full sm:hidden">
          <label className="block text-[11px] font-medium text-zinc-600 mb-1">Sport</label>
          <select
            value={sportFilter}
            onChange={(e) => setSportAndReset(e.target.value)}
            className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            <option value="ALL">All</option>
            {sportOptions.map((o) => (
              <option key={o.key} value={o.label}>
                {o.label}
                {o.count ? ` (${o.count})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden sm:flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
          <Tab active={sportFilter === "ALL"} onClick={() => setSportAndReset("ALL")}>
            All
          </Tab>
          {sportOptions.map((o) => (
            <Tab
              key={o.key}
              active={sportFilter === o.label}
              onClick={() => setSportAndReset(o.label)}
              variant={
                o.label === "Football" ? "football" : o.label === "Soccer" ? "soccer" : "default"
              }
            >
              {o.label}
              {o.count ? ` • ${o.count}` : ""}
            </Tab>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="hidden sm:inline-flex w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 whitespace-nowrap"
        >
          Filters{activeFiltersCount ? ` • ${activeFiltersCount}` : ""}
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search player, set, year, grade..."
            className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 sm:w-80"
          />

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 sm:w-56"
          >
            <option value="PLAYER_ASC">Sort: Player (A→Z)</option>
            <option value="YEAR_DESC">Sort: Year (newest)</option>
            <option value="SET_ASC">Sort: Set (A→Z)</option>
            <option value="TEAM_ASC">Sort: Team (A→Z)</option>
            <option value="EST_VALUE_DESC">Sort: Est. value (high→low)</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="sm:hidden w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 whitespace-nowrap"
          >
            Filters{activeFiltersCount ? ` • ${activeFiltersCount}` : ""}
          </button>
          <button
            onClick={clearAllFilters}
            className="w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
          >
            Clear filters
          </button>
        </div>
      </div>

      {showFilters ? (
        <div className="rounded-lg border bg-zinc-50 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium text-zinc-600 mr-1">Location</div>
            <Link href="/cards/locations" className="text-xs text-zinc-300 underline">
              Manage
            </Link>

            {locationOptions.length === 0 ? (
              <div className="text-xs text-zinc-500">
                No locations yet (edit a card and add Location).
              </div>
            ) : (
              <>
                <Chip active={locationKey === "ALL"} onClick={() => setLocationKey("ALL")}>
                  All
                </Chip>
                {locationOptions.map((opt) => (
                  <Chip
                    key={opt.key}
                    active={locationKey === opt.key}
                    onClick={() => setLocationKey(opt.key)}
                  >
                    {opt.label}
                    {opt.count ? ` • ${opt.count}` : ""}
                  </Chip>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium text-zinc-600 mr-1">Insert</div>

            {insertOptions.length === 0 ? (
              <div className="text-xs text-zinc-500">No inserts yet.</div>
            ) : (
              <>
                <Chip active={insertKey === "ALL"} onClick={() => setInsertKey("ALL")}>
                  All
                </Chip>
                {insertOptions.map((opt) => (
                  <Chip
                    key={opt.key}
                    active={insertKey === opt.key}
                    onClick={() => setInsertKey(opt.key)}
                  >
                    {opt.label}
                    {opt.count ? ` • ${opt.count}` : ""}
                  </Chip>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip active={dupOnly} onClick={() => setDupOnly((v) => !v)}>
              Duplicates{dupInfo.dupCardsCount ? ` • ${dupInfo.dupCardsCount}` : ""}
            </Chip>
            <Chip active={autoOnly} onClick={() => setAutoOnly((v) => !v)}>
              Autograph
            </Chip>
            <Chip active={patchOnly} onClick={() => setPatchOnly((v) => !v)}>
              Patch
            </Chip>
            <Chip active={rookieOnly} onClick={() => setRookieOnly((v) => !v)}>
              Rookie
            </Chip>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium text-zinc-600 mr-1">Parallel</div>

            {parallelOptions.length === 0 ? (
              <div className="text-xs text-zinc-500">No parallels yet.</div>
            ) : (
              <>
                <Chip active={parallelKey === "ALL"} onClick={() => setParallelKey("ALL")}>
                  All
                </Chip>
                {parallelOptions.map((opt) => (
                  <Chip
                    key={opt.key}
                    active={parallelKey === opt.key}
                    onClick={() => setParallelKey(opt.key)}
                  >
                    {opt.label}
                    {opt.count ? ` • ${opt.count}` : ""}
                  </Chip>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium text-zinc-600 mr-1">Numbered</div>

            {numberedOptions.length === 0 ? (
              <div className="text-xs text-zinc-500">No numbered cards yet.</div>
            ) : (
              <>
                <Chip active={numberedKey === "ALL"} onClick={() => setNumberedKey("ALL")}>
                  All
                </Chip>
                {numberedOptions.map((opt) => (
                  <Chip
                    key={opt.key}
                    active={numberedKey === opt.key}
                    onClick={() => setNumberedKey(opt.key)}
                  >
                    {opt.label}
                    {opt.count ? ` • ${opt.count}` : ""}
                  </Chip>
                ))}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                clearCollectorFilters();
                setShowFilters(false);
              }}
              className="btn-secondary"
            >
              Clear filters
            </button>

            <button type="button" onClick={() => setShowFilters(false)} className="btn-link">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
