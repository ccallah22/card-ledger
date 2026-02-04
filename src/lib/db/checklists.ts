import { createClient } from "@/lib/supabase/client";

export type ChecklistEntry = {
  number: string;
  name: string;
  team?: string;
  section: string;
};

const TABLE = "checklist_entries";

export async function dbLoadChecklistEntries(setKey: string): Promise<ChecklistEntry[]> {
  if (!setKey) return [];
  const supabase = createClient();

  const { data, error } = await supabase
    .from(TABLE)
    .select("number, name, team, section")
    .eq("set_key", setKey)
    .order("section", { ascending: true })
    .order("number", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ChecklistEntry[];
}
