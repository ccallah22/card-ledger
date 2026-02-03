"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setEmail(data.user?.email ?? null);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        const name = (err as Error)?.name;
        if (name !== "AbortError") {
          setLoading(false);
        }
      }
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setEmail(data.user?.email ?? null);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        const name = (err as Error)?.name;
        if (name !== "AbortError") {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  function logout() {
    window.location.href = "/login?loggedOut=1";
    setTimeout(() => {
      supabase.auth.signOut().catch(() => {});
    }, 0);
  }

  if (loading) return null;

  if (!email) {
    return (
      <Link
        href="/login"
        style={{
          padding: "8px 10px",
          border: "1px solid #ccc",
          borderRadius: 8,
          textDecoration: "none",
        }}
      >
        Login
      </Link>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{email}</div>
      <button
        type="button"
        onClick={logout}
        style={{
          padding: "8px 10px",
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        Logout
      </button>
    </div>
  );
}
