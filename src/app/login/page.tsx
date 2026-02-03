"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function signUp() {
    setMsg(null);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setMsg(error ? error.message : "Signed up! If email confirmations are enabled, check your email.");
  }

  async function signIn() {
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setMsg(error ? error.message : "Signed in!");
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
        />
      </label>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button onClick={signIn} style={{ padding: "10px 12px" }}>
          Sign In
        </button>
        <button onClick={signUp} style={{ padding: "10px 12px" }}>
          Sign Up
        </button>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
