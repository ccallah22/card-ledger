"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dbLoadCards } from "@/lib/db/cards";
import { cardsToCsv, downloadCsv } from "@/lib/csv";

type Notice = { type: "success" | "error"; message: string } | null;

export default function AccountClient() {
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!active) return;
        setEmail(data?.user?.email ?? "");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function handlePasswordChange() {
    setNotice(null);
    if (newPassword.trim().length < 8) {
      setNotice({ type: "error", message: "Password must be at least 8 characters." });
      return;
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword.trim() });
      if (error) throw error;
      setNewPassword("");
      setNotice({ type: "success", message: "Password updated." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update password.";
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function handleExportCsv() {
    setNotice(null);
    try {
      setBusy(true);
      const cards = await dbLoadCards();
      const csv = cardsToCsv(cards);
      downloadCsv(`thebinder-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      setNotice({ type: "success", message: "Export ready. Check your downloads folder." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export CSV.";
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount() {
    setNotice(null);
    if (deleteConfirm.trim().toLowerCase() !== "delete") {
      setNotice({ type: "error", message: 'Type "delete" to confirm.' });
      return;
    }
    try {
      setDeleting(true);
      const res = await fetch("/api/account/delete", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to delete account.");
      }
      await supabase.auth.signOut();
      window.location.assign("/login?signed_out=1");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete account.";
      setNotice({ type: "error", message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 font-display">
          Account
        </h1>
        <p className="text-sm text-zinc-600">Manage your login, data, and security.</p>
      </header>

      {notice ? (
        <div
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700")
          }
        >
          {notice.message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Account email</h2>
        {loading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : email ? (
          <div className="text-sm text-zinc-700">{email}</div>
        ) : (
          <div className="text-sm text-zinc-500">No email found.</div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Change password</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handlePasswordChange}
            disabled={busy}
            className="btn-primary"
          >
            Update
          </button>
        </div>
        <p className="text-xs text-zinc-500">Minimum 8 characters.</p>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Export data</h2>
        <p className="text-sm text-zinc-600">Download a CSV of your collection.</p>
        <button type="button" onClick={handleExportCsv} disabled={busy} className="btn-secondary">
          Export CSV
        </button>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-rose-800">Delete account</h2>
        <p className="text-sm text-rose-700">
          This permanently deletes your account and collection data.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder='Type "delete" to confirm'
            className="flex-1 rounded-md border border-rose-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="btn-destructive"
          >
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}
