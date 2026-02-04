"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DebugPage() {
  const [state, setState] = useState<any>({ loading: true });

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
      <div className="text-xs text-zinc-600">
        If <b>hasSession</b> is true and you still get bounced from /cards, the issue is route protection logic.
      </div>
    </div>
  );
}
