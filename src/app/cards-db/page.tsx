"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { fetchCardsPage, type CardRow } from "@/lib/cardsDb";
import { signImage } from "@/lib/cardImages";

const PAGE_SIZE = 50;

function CardsDbInner() {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const [frontUrls, setFrontUrls] = useState<Record<string, string>>({});

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  useEffect(() => {
    (async () => {
      setMsg(null);
      try {
        const res = await fetchCardsPage({ page, pageSize: PAGE_SIZE });
        setRows(res.rows);
        setTotal(res.total);

        const urlMap: Record<string, string> = {};
        for (const r of res.rows) {
          if (r.image_front_url) {
            urlMap[r.id] = await signImage(r.image_front_url, 60 * 30);
          }
        }
        setFrontUrls(urlMap);
      } catch (e: any) {
        setMsg(e?.message ?? "Load failed");
      }
    })();
  }, [page]);

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Supabase Cards (DB)</h1>

      {msg && <p style={{ marginTop: 10 }}>{msg}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <div>
          Page {page} / {totalPages} ({total} cards)
        </div>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div style={{ width: 90, height: 126, background: "#f3f3f3", flexShrink: 0 }}>
              {frontUrls[r.id] ? (
                <img
                  src={frontUrls[r.id]}
                  alt={r.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  loading="lazy"
                />
              ) : null}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{r.name}</div>
              <div style={{ opacity: 0.75, marginTop: 4 }}>
                Status: {r.status} {r.paid != null ? `• Paid: $${r.paid}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CardsDbPage() {
  return (
    <RequireAuth>
      <CardsDbInner />
    </RequireAuth>
  );
}
