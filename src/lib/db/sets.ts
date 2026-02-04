import { createClient } from "@/lib/supabase/client";

export type SetEntry = {
  year: string;
  name: string;
  brand?: string;
  sport?: string;
  checklistKey?: string;
};

const TABLE = "sets";

export async function dbLoadSets(): Promise<SetEntry[]> {
  const supabase = createClient();
  const pageSize = 1000;
  let from = 0;
  const all: SetEntry[] = [];

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("year, name, brand, sport, checklist_key")
      .order("year", { ascending: false })
      .order("name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []).map((r: any) => ({
      year: String(r.year),
      name: String(r.name),
      brand: r.brand ?? undefined,
      sport: r.sport ?? undefined,
      checklistKey: r.checklist_key ?? undefined,
    }));
    all.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}
