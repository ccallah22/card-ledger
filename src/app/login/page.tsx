"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/";
  const loggedOut = searchParams.get("loggedOut") === "1";

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(nextUrl);
    });
  }, [router, nextUrl]);

  async function signUp() {
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Signed up! Now try Sign In (or confirm your email if required).");
  }

  async function signIn() {
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: pw,
    });
    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.replace(nextUrl);
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Login</h1>

      <label style={{ display: "block", marginTop: 12 }}>
        Email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          placeholder="you@email.com"
          autoComplete="email"
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Password
        <input
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
      </label>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button onClick={signIn} disabled={busy} style={{ padding: "10px 12px" }}>
          Sign In
        </button>
        <button onClick={signUp} disabled={busy} style={{ padding: "10px 12px" }}>
          Sign Up
        </button>
      </div>

      {loggedOut && !msg ? <p style={{ marginTop: 12 }}>You&apos;ve been logged out.</p> : null}
      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
