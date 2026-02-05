import { createClient } from "@/lib/supabase/client";

export type ChecklistEntry = {
  number: string;
  name: string;
  team?: string;
  section: string;
};

const TABLE = "checklist_entries";
const PARALLELS_TABLE = "checklist_section_parallels";

export async function dbLoadChecklistEntries(setKey: string): Promise<ChecklistEntry[]> {
  if (!setKey) return [];
  const supabase = createClient();

  const pageSize = 1000;
  let from = 0;
  const all: ChecklistEntry[] = [];

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("number, name, team, section")
      .eq("set_key", setKey)
      .order("section", { ascending: true })
      .order("number", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as ChecklistEntry[];
    all.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function dbLoadChecklistSectionParallels(
  setKey: string
): Promise<Record<string, string[]>> {
  if (!setKey) return {};
  const supabase = createClient();

  const pageSize = 1000;
  let from = 0;
  const all: { section: string; parallel: string }[] = [];

  while (true) {
    const { data, error } = await supabase
      .from(PARALLELS_TABLE)
      .select("section, parallel")
      .eq("set_key", setKey)
      .order("section", { ascending: true })
      .order("parallel", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as { section: string; parallel: string }[];
    all.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const map: Record<string, string[]> = {};
  for (const row of all) {
    if (!row.section || !row.parallel) continue;
    if (!map[row.section]) map[row.section] = [];
    map[row.section].push(row.parallel);
  }
  return map;
}
