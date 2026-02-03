"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignUp() {
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "Sign up successful. You can now sign in.");
    setBusy(false);
  }

  async function handleSignIn() {
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "Signed in successfully.");
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Log in</h1>
      <p>Enter your email and password.</p>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{ width: "100%", padding: 10, marginTop: 10 }}
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password (6+ chars)"
        type="password"
        style={{ width: "100%", padding: 10, marginTop: 10 }}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button
          onClick={handleSignUp}
          disabled={busy}
          style={{ flex: 1, padding: 10 }}
        >
          Sign up
        </button>
        <button
          onClick={handleSignIn}
          disabled={busy}
          style={{ flex: 1, padding: 10 }}
        >
          Sign in
        </button>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
