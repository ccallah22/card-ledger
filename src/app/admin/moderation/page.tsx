"use client";

import { useEffect, useState } from "react";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";

type ReportItem = {
  fingerprint: string;
  imageUrl: string;
  reports: number;
  status: "active" | "blocked" | "approved";
  reasons: Record<string, number>;
  updatedAt: string;
};

export default function ModerationPage() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    fetch("/api/image-reports")
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function act(fingerprint: string, action: "approve" | "block" | "clear") {
    await fetch("/api/image-reports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, action }),
    });
    refresh();
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Image Moderation</h1>
        <p className="text-sm text-zinc-600">
          Auto-hide threshold: {REPORT_HIDE_THRESHOLD} reports.
        </p>
      </div>

      {loading ? <div className="text-sm">Loading…</div> : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-zinc-600">
          No reports yet.
        </div>
      ) : null}

      <div className="grid gap-4">
        {items.map((item) => {
          const hidden = item.status === "blocked" || item.reports >= REPORT_HIDE_THRESHOLD;
          return (
            <div key={item.fingerprint} className="rounded-xl border bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-4">
                  <div className="h-28 w-20 rounded-md border bg-zinc-50 overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="Reported" className="h-full w-full object-contain" />
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-zinc-500">Fingerprint</div>
                    <div className="text-sm font-medium break-all">{item.fingerprint}</div>
                    <div className="text-xs text-zinc-600">
                      Reports: {item.reports} • Status: {item.status} • Hidden: {hidden ? "Yes" : "No"}
                    </div>
                    {Object.keys(item.reasons || {}).length ? (
                      <div className="text-xs text-zinc-600">
                        Reasons:{" "}
                        {Object.entries(item.reasons)
                          .map(([k, v]) => `${k} (${v})`)
                          .join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(item.fingerprint, "approve")}
                    className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => act(item.fingerprint, "clear")}
                    className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                  >
                    Clear reports
                  </button>
                  <button
                    type="button"
                    onClick={() => act(item.fingerprint, "block")}
                    className="rounded-md bg-[var(--brand-primary)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--brand-primary-strong)]"
                  >
                    Block
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
