import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TABLE = "checklist_entries";
const PARALLELS_TABLE = "checklist_section_parallels";

function parseAdminEmails(): string[] {
  const raw = process.env.CHECKLIST_ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function loadSectionCounts(supabase: any, table: string, setKey: string) {
  const pageSize = 1000;
  let from = 0;
  const counts = new Map<string, number>();

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("section")
      .eq("set_key", setKey)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { section: string }[];
    for (const row of rows) {
      const key = String(row.section ?? "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const admins = parseAdminEmails();
  if (admins.length && !admins.includes(String(user.email ?? "").toLowerCase())) {
    return NextResponse.json({ message: "Not authorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const setKey = String(url.searchParams.get("setKey") ?? "").trim();
  if (!setKey) {
    return NextResponse.json({ message: "Missing setKey" }, { status: 400 });
  }

  try {
    const [sectionCounts, parallelCounts] = await Promise.all([
      loadSectionCounts(supabase, TABLE, setKey),
      loadSectionCounts(supabase, PARALLELS_TABLE, setKey),
    ]);

    return NextResponse.json({
      setKey,
      entryCount: sectionCounts.reduce((sum, [, count]) => sum + count, 0),
      sectionCounts,
      parallelCount: parallelCounts.reduce((sum, [, count]) => sum + count, 0),
      parallelCounts,
    });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message ?? "Preview failed" }, { status: 400 });
  }
}
