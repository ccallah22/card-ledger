"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";

export default function LoginClient() {
  const searchParams = useSearchParams();

  const nextPath = useMemo(() => {
    return searchParams.get("next") || "/cards";
  }, [searchParams]);

  return (
    <main style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Login</h1>

      <p style={{ marginBottom: 16 }}>
        After logging in, you’ll go to: <code>{nextPath}</code>
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        <button
          onClick={() => {
            window.location.href = nextPath;
          }}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            fontWeight: 600,
          }}
        >
          Continue
        </button>

        <Link href="/" style={{ textDecoration: "underline" }}>
          Back home
        </Link>
      </div>
    </main>
  );
}
