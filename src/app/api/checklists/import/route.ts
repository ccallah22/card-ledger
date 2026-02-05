import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Entry = {
  number: string;
  name: string;
  team?: string;
  section: string;
};

const TABLE = "checklist_entries";
const PARALLELS_TABLE = "checklist_section_parallels";
const SETS_TABLE = "sets";

function parseAdminEmails(): string[] {
  const raw = process.env.CHECKLIST_ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(req: Request) {
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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const setKey = String(body?.setKey ?? "").trim();
  const replace = Boolean(body?.replace);
  const entries = Array.isArray(body?.entries) ? (body.entries as Entry[]) : [];
  const setMeta = body?.set ?? null;
  const sectionParallels =
    body?.sectionParallels && typeof body.sectionParallels === "object"
      ? (body.sectionParallels as Record<string, string[]>)
      : null;

  if (!setKey) {
    return NextResponse.json({ message: "Missing setKey" }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ message: "No entries provided" }, { status: 400 });
  }

  if (setMeta?.year && setMeta?.name) {
    const year = String(setMeta.year).trim();
    const name = String(setMeta.name).trim();
    if (year && name) {
      const { error: setErr } = await supabase
        .from(SETS_TABLE)
        .upsert(
          {
            year,
            name,
            brand: setMeta.brand ? String(setMeta.brand).trim() : null,
            sport: setMeta.sport ? String(setMeta.sport).trim() : null,
            checklist_key: setKey,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "year,name" }
        );
      if (setErr) {
        return NextResponse.json({ message: setErr.message }, { status: 400 });
      }
    }
  }

  if (replace) {
    const { error: delErr } = await supabase
      .from(TABLE)
      .delete()
      .eq("set_key", setKey);
    if (delErr) {
      return NextResponse.json({ message: delErr.message }, { status: 400 });
    }
    if (sectionParallels) {
      const { error: delParallelsErr } = await supabase
        .from(PARALLELS_TABLE)
        .delete()
        .eq("set_key", setKey);
      if (delParallelsErr) {
        return NextResponse.json({ message: delParallelsErr.message }, { status: 400 });
      }
    }
  }

  const rows = entries
    .map((e) => ({
      set_key: setKey,
      number: String(e?.number ?? "").trim(),
      name: String(e?.name ?? "").trim(),
      team: e?.team ? String(e.team).trim() : null,
      section: String(e?.section ?? "").trim(),
    }))
    .filter((r) => r.number && r.name && r.section);

  if (!rows.length) {
    return NextResponse.json({ message: "No valid entries provided" }, { status: 400 });
  }

  const { error } = await supabase.from(TABLE).insert(rows);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  if (sectionParallels) {
    const parallelRows = Object.entries(sectionParallels)
      .flatMap(([section, parallels]) =>
        (parallels ?? []).map((parallel) => ({
          set_key: setKey,
          section: String(section).trim(),
          parallel: String(parallel ?? "").trim(),
        }))
      )
      .filter((r) => r.section && r.parallel);

    if (parallelRows.length) {
      const { error: parallelErr } = await supabase.from(PARALLELS_TABLE).insert(parallelRows);
      if (parallelErr) {
        return NextResponse.json({ message: parallelErr.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({
    inserted: rows.length,
    deleted: replace ? 1 : 0,
  });
}
