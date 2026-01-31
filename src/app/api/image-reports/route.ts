import { NextResponse } from "next/server";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";

type ReportStatus = "active" | "blocked" | "approved";

type ReportItem = {
  fingerprint: string;
  imageUrl: string;
  reports: number;
  status: ReportStatus;
  reasons: Record<string, number>;
  updatedAt: string;
};

const store: Map<string, ReportItem> =
  (globalThis as any).__imageReportStore ?? new Map();
(globalThis as any).__imageReportStore = store;

function nowIso() {
  return new Date().toISOString();
}

function getOrCreate(fingerprint: string, imageUrl: string) {
  const existing = store.get(fingerprint);
  if (existing) return existing;
  const item: ReportItem = {
    fingerprint,
    imageUrl,
    reports: 0,
    status: "active",
    reasons: {},
    updatedAt: nowIso(),
  };
  store.set(fingerprint, item);
  return item;
}

export async function GET() {
  const items = Array.from(store.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  return NextResponse.json({
    threshold: REPORT_HIDE_THRESHOLD,
    items,
  });
}

export async function POST(req: Request) {
  try {
    const { fingerprint, imageUrl, reason } = await req.json();
    if (!fingerprint || typeof fingerprint !== "string") {
      return NextResponse.json({ message: "Missing fingerprint." }, { status: 400 });
    }
    if (!imageUrl || typeof imageUrl !== "string") {
      return NextResponse.json({ message: "Missing imageUrl." }, { status: 400 });
    }

    const item = getOrCreate(fingerprint, imageUrl);
    item.reports += 1;
    item.updatedAt = nowIso();
    const key = typeof reason === "string" ? reason : "Other";
    item.reasons[key] = (item.reasons[key] ?? 0) + 1;

    store.set(fingerprint, item);
    return NextResponse.json({
      fingerprint,
      reports: item.reports,
      status: item.status,
      hidden: item.status === "blocked" || item.reports >= REPORT_HIDE_THRESHOLD,
    });
  } catch {
    return NextResponse.json({ message: "Report failed." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { fingerprint, action } = await req.json();
    if (!fingerprint || typeof fingerprint !== "string") {
      return NextResponse.json({ message: "Missing fingerprint." }, { status: 400 });
    }
    const item = store.get(fingerprint);
    if (!item) return NextResponse.json({ message: "Not found." }, { status: 404 });

    if (action === "approve") {
      item.status = "approved";
      item.reports = 0;
      item.reasons = {};
    } else if (action === "block") {
      item.status = "blocked";
    } else if (action === "clear") {
      item.status = "active";
      item.reports = 0;
      item.reasons = {};
    } else {
      return NextResponse.json({ message: "Invalid action." }, { status: 400 });
    }
    item.updatedAt = nowIso();
    store.set(fingerprint, item);

    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ message: "Update failed." }, { status: 500 });
  }
}
