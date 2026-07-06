import { supabase } from "@/lib/supabaseClient";

export type GradingCompanyRow = {
  id: number;
  name: string;
  abbreviation: string;
  website: string | null;
  created_at: string;
  updated_at: string;
};

export async function listGradingCompanies(): Promise<GradingCompanyRow[]> {
  const { data, error } = await supabase
    .from("grading_companies")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as GradingCompanyRow[];
}

export async function findGradingCompanyByName(
  name: string,
): Promise<GradingCompanyRow | null> {
  const { data, error } = await supabase
    .from("grading_companies")
    .select("*")
    .or(`name.ilike.${name},abbreviation.ilike.${name}`)
    .maybeSingle();

  if (error) throw error;

  return data as GradingCompanyRow | null;
}

export async function findOrCreateGradingCompany(
  name: string,
): Promise<GradingCompanyRow> {
  const existing = await findGradingCompanyByName(name);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("grading_companies")
    .insert({ name, abbreviation: name })
    .select("*")
    .single();

  if (error) throw error;

  return data as GradingCompanyRow;
}
