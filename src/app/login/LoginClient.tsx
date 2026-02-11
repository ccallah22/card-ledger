"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginClient() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/cards", [searchParams]);
  const signedOut = useMemo(() => searchParams.get("signed_out") === "1", [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    if (signedOut) setInfo("You’ve been signed out.");
  }, [signedOut]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault(); // prevents page reload
    setError("");
    setInfo("");
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
        mode === "signin"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Sign-in timed out")), timeoutMs)
        ),
      ]);

      if (res.error) {
        const message =
          res.error.message === "Email not confirmed"
            ? "Check your email to confirm your account, then sign in."
            : res.error.message;
        setError(message);
        setStatus("idle");
        return;
      }

      if (mode === "signup") {
        setStatus("success");
        setInfo("Account created. Check your email to confirm, then sign in.");
        return;
      }

      // Double-check session exists
      const sessionRes = await supabase.auth.getSession();

      if (!sessionRes.data.session) {
        setError("Login returned no session. Check Supabase Auth settings (email confirmed?).");
        setStatus("idle");
        return;
      }

      setStatus("success");
      window.location.assign(nextPath);
    } catch (err) {
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
        {mode === "signup" ? (
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            We’ll email a confirmation link before you can sign in.
          </div>
        ) : null}

        {info ? (
          <div style={{ padding: 10, borderRadius: 10, border: "1px solid #86efac" }}>
            {info}
          </div>
        ) : null}

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
          {status === "loading"
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : status === "success"
            ? mode === "signin"
              ? "Signed in!"
              : "Account created"
            : mode === "signin"
            ? "Sign in"
            : "Sign up"}
        </button>
      </form>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        {mode === "signin" ? (
          <button
            type="button"
            onClick={() => setMode("signup")}
            style={{ textDecoration: "underline" }}
          >
            Need an account? Sign up
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode("signin")}
            style={{ textDecoration: "underline" }}
          >
            Have an account? Sign in
          </button>
        )}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8 }} />
    </main>
  );
}
