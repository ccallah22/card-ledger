import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type ChecklistSectionRow = {
  id: number;
  set_id: number;
  name: string;
  slug: string;
  section_category: string;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

export async function listChecklistSections(setId: number): Promise<ChecklistSectionRow[]> {
  const { data, error } = await supabase
    .from("checklist_sections")
    .select("*")
    .eq("set_id", setId)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as ChecklistSectionRow[];
}

export async function findChecklistSectionBySlug(
  setId: number,
  slug: string,
): Promise<ChecklistSectionRow | null> {
  const { data, error } = await supabase
    .from("checklist_sections")
    .select("*")
    .eq("set_id", setId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as ChecklistSectionRow | null;
}

export type CreateChecklistSectionInput = {
  set_id: number;
  name: string;
  section_category: string;
  sort_order?: number | null;
};

export async function createChecklistSection(
  input: CreateChecklistSectionInput,
): Promise<ChecklistSectionRow> {
  const slug = slugify(input.name);

  const { data, error } = await supabase
    .from("checklist_sections")
    .insert({
      set_id: input.set_id,
      name: input.name,
      section_category: input.section_category,
      sort_order: input.sort_order ?? null,
      slug,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as ChecklistSectionRow;
}

export async function findOrCreateChecklistSection(
  input: CreateChecklistSectionInput,
): Promise<ChecklistSectionRow> {
  const slug = slugify(input.name);
  const existing = await findChecklistSectionBySlug(input.set_id, slug);
  if (existing) return existing;
  return createChecklistSection(input);
}
