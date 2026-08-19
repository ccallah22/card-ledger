import { NextResponse } from "next/server";
import { getImageReportStore } from "@/lib/imageReportStore";

type BatchReportSummary = {
  fingerprint: string;
  reports: number;
  status: string;
};

export async function POST(req: Request) {
  try {
    const { fingerprints } = await req.json();
    if (!Array.isArray(fingerprints)) {
      return NextResponse.json({ message: "Missing fingerprints." }, { status: 400 });
    }

    const store = getImageReportStore();
    const result: Record<string, BatchReportSummary> = {};
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
