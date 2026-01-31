import { NextResponse } from "next/server";

type ReportItem = {
  fingerprint: string;
  reports: number;
  status: string;
};

const store: Map<string, any> = (globalThis as any).__imageReportStore ?? new Map();
(globalThis as any).__imageReportStore = store;

export async function POST(req: Request) {
  try {
    const { fingerprints } = await req.json();
    if (!Array.isArray(fingerprints)) {
      return NextResponse.json({ message: "Missing fingerprints." }, { status: 400 });
    }

    const result: Record<string, ReportItem> = {};
    for (const fp of fingerprints) {
      const item = store.get(fp);
      if (item) {
        result[fp] = {
          fingerprint: fp,
          reports: item.reports ?? 0,
          status: item.status ?? "active",
        };
      }
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ message: "Batch failed." }, { status: 500 });
  }
}
