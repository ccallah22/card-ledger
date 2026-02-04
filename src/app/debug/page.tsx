"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DebugPage() {
  const [state, setState] = useState<any>({ loading: true });
  const [dedupeState, setDedupeState] = useState<any>(null);
  const [dedupeLoading, setDedupeLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data, error }) => {
      setState({
        loading: false,
        error: error?.message ?? null,
        userId: data.session?.user?.id ?? null,
        email: data.session?.user?.email ?? null,
        hasSession: Boolean(data.session),
      });
    });
  }, []);

  return (
    <div className="mx-auto max-w-xl p-6 space-y-3">
      <h1 className="text-xl font-semibold">Debug</h1>
      <pre className="rounded-md border bg-white p-3 text-sm overflow-auto">
        {JSON.stringify(state, null, 2)}
      </pre>
      <button
        type="button"
        onClick={async () => {
          setDedupeLoading(true);
          setDedupeState(null);
          try {
            const res = await fetch("/api/cards/dedupe", { method: "POST" });
            const text = await res.text();
            let json: any = null;
            try {
              json = JSON.parse(text);
            } catch {
              json = text;
            }
            setDedupeState({ status: res.status, body: json });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setDedupeState({ error: message });
          } finally {
            setDedupeLoading(false);
          }
        }}
        className="rounded-md border bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        disabled={dedupeLoading}
      >
        {dedupeLoading ? "Running dedupe…" : "Run dedupe now"}
      </button>
      {dedupeState ? (
        <pre className="rounded-md border bg-white p-3 text-sm overflow-auto">
          {JSON.stringify(dedupeState, null, 2)}
        </pre>
      ) : null}
      <div className="text-xs text-zinc-600">
        If <b>hasSession</b> is true and you still get bounced from /cards, the issue is route protection logic.
      </div>
    </div>
  );
}
