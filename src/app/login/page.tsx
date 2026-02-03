"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  async function sendLink() {
    setMsg("Sending link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/cards`,
      },
    });
    setMsg(error ? error.message : "Check your email for the sign-in link.");
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Log in</h1>
      <p>Enter your email to get a sign-in link.</p>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{ width: "100%", padding: 10, marginTop: 10 }}
      />

      <button
        onClick={sendLink}
        style={{ width: "100%", padding: 10, marginTop: 10 }}
      >
        Send login link
      </button>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
