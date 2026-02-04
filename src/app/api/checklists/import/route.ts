import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Entry = {
  number: string;
  name: string;
  team?: string;
  section: string;
};

const TABLE = "checklist_entries";

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

  if (!setKey) {
    return NextResponse.json({ message: "Missing setKey" }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ message: "No entries provided" }, { status: 400 });
  }

  if (replace) {
    const { error: delErr } = await supabase
      .from(TABLE)
      .delete()
      .eq("set_key", setKey);
    if (delErr) {
      return NextResponse.json({ message: delErr.message }, { status: 400 });
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

  return NextResponse.json({
    inserted: rows.length,
    deleted: replace ? 1 : 0,
  });
}
