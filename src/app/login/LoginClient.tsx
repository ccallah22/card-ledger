"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginClient() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/cards", [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [error, setError] = useState<string>("");

  async function onLogin(e: React.FormEvent) {
    e.preventDefault(); // prevents page reload
    setError("");
    setStatus("loading");

    const supabase = createClient();
    if (!supabase) {
      setError(
        "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel."
      );
      setStatus("idle");
      return;
    }

    try {
      const timeoutMs = 15000;
      const res = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Sign-in timed out")), timeoutMs)
        ),
      ]);

      console.log("signInWithPassword result:", res);

      if (res.error) {
        setError(res.error.message);
        setStatus("idle");
        return;
      }

      // Double-check session exists
      const sessionRes = await supabase.auth.getSession();
      console.log("session after login:", sessionRes);

      if (!sessionRes.data.session) {
        setError("Login returned no session. Check Supabase Auth settings (email confirmed?).");
        setStatus("idle");
        return;
      }

      setStatus("success");
      window.location.assign(nextPath);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unexpected error during login.";
      setError(message);
      setStatus("idle");
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Login</h1>

      <form onSubmit={onLogin} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
          />
        </label>

        {error ? (
          <div style={{ padding: 10, borderRadius: 10, border: "1px solid #fca5a5" }}>
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={status === "loading"}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            fontWeight: 600,
            opacity: status === "loading" ? 0.7 : 1,
            cursor: status === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {status === "loading" ? "Signing in…" : status === "success" ? "Signed in!" : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8 }}>
        Redirect target: <code>{nextPath}</code>
      </div>
    </main>
  );
}
