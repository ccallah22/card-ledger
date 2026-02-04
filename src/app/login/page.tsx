"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();

    try {
      const timeoutMs = 15000;
      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Sign-in timed out")), timeoutMs)
        ),
      ]);

      if (result.error) {
        setError(result.error.message);
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) {
        setError("No session returned after sign-in.");
        return;
      }

      router.replace("/cards");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected sign-in error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onLogin}
      className="mx-auto mt-24 max-w-sm space-y-4 rounded-xl border bg-white p-6"
    >
      <h1 className="text-xl font-semibold">Sign in</h1>

      <input
        className="w-full rounded-md border px-3 py-2"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        className="w-full rounded-md border px-3 py-2"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
