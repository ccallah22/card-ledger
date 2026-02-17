"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/client";
import { dbLoadCards } from "@/lib/db/cards";
import {
  getOrCreateDeviceId,
  listMyDeviceSessions,
  revokeOtherDeviceSessions,
  type DeviceSession,
} from "@/lib/db/deviceSessions";
import { cardsToCsv, downloadCsv } from "@/lib/csv";
import type { SportsCard } from "@/lib/types";

type Notice = { type: "success" | "error"; message: string } | null;

type CollectionStats = {
  totalCards: number;
  totalValue: number;
  totalInvested: number;
  netPosition: number;
  locationsCount: number;
};

type TotpEnrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

const LAST_EXPORT_KEY = "thebinder.lastExportAt";

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatDate(isoDate?: string | null) {
  if (!isoDate) return "—";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function browserLabel(ua: string) {
  if (!ua) return "Unknown Browser";
  if (ua.includes("Edg/")) return "Microsoft Edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Google Chrome";
  if (ua.includes("Firefox/")) return "Mozilla Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return "Web Browser";
}

function toStats(cards: SportsCard[]): CollectionStats {
  const collectionCards = cards.filter((card) => card.status !== "WANT");
  const invested = collectionCards.reduce((sum, card) => sum + (card.purchasePrice ?? 0), 0);
  const value = collectionCards.reduce((sum, card) => sum + (card.marketValue ?? 0), 0);
  const locations = new Set(
    collectionCards.map((card) => (card.location ?? "").trim()).filter(Boolean)
  );

  return {
    totalCards: collectionCards.length,
    totalValue: value,
    totalInvested: invested,
    netPosition: value - invested,
    locationsCount: locations.size,
  };
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <span className="text-sm text-zinc-600">{label}</span>
      <span className="text-sm font-semibold text-zinc-900">{value}</span>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
  className = "",
}: {
  icon: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ${className}`}>
      <header className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold text-zinc-900">
          <span className="mr-2" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        <p className="text-sm text-zinc-600">{description}</p>
      </header>
      {children}
    </section>
  );
}

export default function AccountClient() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [securityBusy, setSecurityBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [lastSignIn, setLastSignIn] = useState<string | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [currentDeviceName, setCurrentDeviceName] = useState("Current device");
  const [mfaEnabledAt, setMfaEnabledAt] = useState<string | null>(null);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [stats, setStats] = useState<CollectionStats>({
    totalCards: 0,
    totalValue: 0,
    totalInvested: 0,
    netPosition: 0,
    locationsCount: 0,
  });

  const [newPassword, setNewPassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const currentDeviceId = typeof window === "undefined" ? "server" : getOrCreateDeviceId();

  const refreshSecurityState = useCallback(async () => {
    const [{ data: factorData, error: factorError }, { data: userData, error: userError }] =
      await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.getUser()]);

    if (factorError) throw factorError;
    if (userError) throw userError;

    const verifiedTotp = factorData?.totp?.[0];
    setMfaEnabledAt(verifiedTotp?.created_at ?? null);

    const user = userData?.user;
    if (user) {
      setEmail(user.email ?? "");
      setUserId(user.id ?? "");
      setMemberSince(user.created_at ?? null);
      setLastSignIn(user.last_sign_in_at ?? null);
    }
  }, [supabase]);

  const refreshDeviceSessions = useCallback(async () => {
    const data = await listMyDeviceSessions();
    setSessions(data);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cards] = await Promise.all([dbLoadCards().catch(() => [] as SportsCard[])]);

        if (!active) return;
        setStats(toStats(cards));
        await refreshSecurityState();
        await refreshDeviceSessions();
        if (typeof navigator !== "undefined") {
          setCurrentDeviceName(browserLabel(navigator.userAgent));
        }

        if (typeof window !== "undefined") {
          const lastExport = window.localStorage.getItem(LAST_EXPORT_KEY);
          setLastExportAt(lastExport);
        }
      } finally {
        if (active) {
          setLoading(false);
          setStatsLoading(false);
          setSessionsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshDeviceSessions, refreshSecurityState]);

  async function handleEnable2FA() {
    setNotice(null);
    setTotpCode("");
    try {
      setSecurityBusy(true);
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });
      if (error) throw error;
      if (!data || data.type !== "totp") {
        throw new Error("Could not start 2FA setup.");
      }

      setTotpEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t start 2FA setup right now. Please try again.";
      setNotice({ type: "error", message });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function handleVerify2FA() {
    setNotice(null);
    if (!totpEnrollment) return;
    const normalized = totpCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(normalized)) {
      setNotice({ type: "error", message: "Enter a valid 6-digit authentication code." });
      return;
    }

    try {
      setSecurityBusy(true);
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: totpEnrollment.factorId,
        code: normalized,
      });
      if (error) throw error;

      setTotpEnrollment(null);
      setTotpCode("");
      await refreshSecurityState();
      setNotice({ type: "success", message: "Two-factor authentication is now enabled." });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t verify your code. Please check the code and try again.";
      setNotice({ type: "error", message });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function handleDisable2FA() {
    setNotice(null);
    try {
      setSecurityBusy(true);
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;

      const verifiedTotp = data?.totp?.[0];
      if (!verifiedTotp) {
        setNotice({ type: "error", message: "No enabled 2FA factor was found for this account." });
        return;
      }

      const { error: unenrollError } = await supabase.auth.mfa.unenroll({
        factorId: verifiedTotp.id,
      });
      if (unenrollError) throw unenrollError;

      await refreshSecurityState();
      setNotice({ type: "success", message: "Two-factor authentication has been disabled." });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t disable 2FA right now. Please try again.";
      setNotice({ type: "error", message });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function handleSignOutOtherSessions() {
    setNotice(null);
    try {
      setSecurityBusy(true);
      await revokeOtherDeviceSessions();
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      setNotice({
        type: "success",
        message: "Signed out from other active sessions. This device stays signed in.",
      });
      await refreshSecurityState();
      await refreshDeviceSessions();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t revoke other sessions right now. Please try again.";
      setNotice({ type: "error", message });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function handlePasswordChange() {
    setNotice(null);

    if (newPassword.trim().length < 8) {
      setNotice({
        type: "error",
        message:
          "Use at least 8 characters. We recommend a mix of letters, numbers, and symbols.",
      });
      return;
    }

    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword.trim() });
      if (error) throw error;

      setNewPassword("");
      setNotice({ type: "success", message: "Your password was updated successfully." });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "We couldn’t update your password right now.";
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

      const now = new Date().toISOString();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_EXPORT_KEY, now);
      }
      setLastExportAt(now);

      setNotice({ type: "success", message: "Your CSV export is ready in Downloads." });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t export your data. Please check your connection and try again.";
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount() {
    setNotice(null);
    if (deleteConfirm.trim() !== "DELETE") {
      setNotice({ type: "error", message: "Type DELETE to permanently remove your account." });
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
      const message =
        err instanceof Error
          ? err.message
          : "We couldn’t delete your account right now. Please try again.";
      setNotice({ type: "error", message });
    } finally {
      setDeleting(false);
    }
  }

  const planLabel = "Free";
  const appVersion = "v0.9.2";

  return (
    <div className="space-y-8 pb-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 font-display">
          Account Settings
        </h1>
        <p className="text-sm text-zinc-600">Your collection. Your data. Your control.</p>
        {!loading && email ? (
          <p className="text-xs text-zinc-500">You’re signed in as {email}</p>
        ) : null}
      </header>

      {notice ? (
        <div
          className={
            "rounded-xl border px-4 py-3 text-sm " +
            (notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700")
          }
        >
          {notice.message}
        </div>
      ) : null}

      <SectionCard
        icon="👤"
        title="Profile Information"
        description="Manage your personal details."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <StatRow label="Account Email" value={loading ? "Loading…" : email || "—"} />
          <StatRow label="Member Since" value={loading ? "Loading…" : formatDate(memberSince)} />
          <StatRow label="Plan" value={planLabel} />
          <StatRow
            label="Account ID"
            value={loading ? "Loading…" : userId ? `${userId.slice(0, 8)}…` : "—"}
          />
        </div>
        {userId ? <p className="mt-3 break-all text-xs text-zinc-500">Full ID: {userId}</p> : null}
      </SectionCard>

      <SectionCard
        icon="📊"
        title="Collection Overview"
        description="A quick summary of your collection portfolio."
      >
        {statsLoading ? (
          <div className="loading-state">Loading your collection overview…</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <StatRow label="Total Cards" value={String(stats.totalCards)} />
            <StatRow label="Total Value" value={formatCurrency(stats.totalValue)} />
            <StatRow label="Total Invested" value={formatCurrency(stats.totalInvested)} />
            <StatRow
              label="Net Position"
              value={`${stats.netPosition >= 0 ? "+" : "-"}${formatCurrency(Math.abs(stats.netPosition))}`}
            />
            <StatRow label="Storage Locations" value={String(stats.locationsCount)} />
            <StatRow label="Last Export" value={formatDate(lastExportAt)} />
          </div>
        )}
      </SectionCard>

      <SectionCard icon="🔒" title="Security" description="Protect access to your account.">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <StatRow label="Last Login Date" value={formatDate(lastSignIn)} />
            <StatRow label="Two-Factor Authentication" value={mfaEnabledAt ? "Enabled" : "Not Enabled"} />
            <StatRow label="2FA Enabled On" value={formatDate(mfaEnabledAt)} />
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">Two-Factor Authentication</h3>
            <p className="text-xs text-zinc-600">
              Add an extra layer of security to protect your collection.
            </p>
            {!mfaEnabledAt ? (
              <button
                type="button"
                onClick={handleEnable2FA}
                disabled={securityBusy || !!totpEnrollment}
                className="btn-secondary"
              >
                {securityBusy ? "Starting…" : "Enable 2FA"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDisable2FA}
                disabled={securityBusy}
                className="btn-secondary"
              >
                {securityBusy ? "Updating…" : "Disable 2FA"}
              </button>
            )}

            {totpEnrollment ? (
              <div className="space-y-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs text-zinc-700">
                  Scan this QR code with Google Authenticator, Authy, or another authenticator app.
                </p>
                <Image
                  src={totpEnrollment.qrCode}
                  alt="Two-factor authentication QR code"
                  width={176}
                  height={176}
                  unoptimized
                  className="h-44 w-44 rounded border border-zinc-200 bg-white p-2"
                />
                <div>
                  <div className="text-xs font-medium text-zinc-700">Can’t scan?</div>
                  <code className="block break-all rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
                    {totpEnrollment.secret}
                  </code>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    inputMode="numeric"
                    className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={handleVerify2FA}
                    disabled={securityBusy}
                    className="btn-primary"
                  >
                    {securityBusy ? "Verifying…" : "Verify and Enable"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">Active Sessions</h3>
            {sessionsLoading ? (
              <div className="loading-state">Loading active sessions…</div>
            ) : sessions.length === 0 ? (
              <div className="empty-state">No active sessions found yet.</div>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => {
                  const isCurrent = session.device_id === currentDeviceId;
                  return (
                    <div
                      key={session.id}
                      className="rounded-md border border-zinc-200 bg-white p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-zinc-900">
                            {isCurrent ? currentDeviceName : session.device_name || "Web Device"}
                          </p>
                          <p className="text-xs text-zinc-600">
                            Last active: {formatDate(session.last_seen_at)}
                          </p>
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                            Current Device
                          </span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                            Active
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={handleSignOutOtherSessions}
              disabled={securityBusy || sessions.length <= 1}
              className="btn-secondary"
            >
              {securityBusy ? "Updating…" : "Log Out Other Sessions"}
            </button>
            {sessions.length <= 1 ? (
              <p className="text-xs text-zinc-500">
                Sign in on another device to manage and revoke it here.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
            <label htmlFor="new-password" className="text-sm font-semibold text-zinc-900">
              Change Password
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
              />
              <button
                type="button"
                onClick={handlePasswordChange}
                disabled={busy}
                className="btn-primary"
              >
                {busy ? "Saving…" : "Change Password"}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Use at least 8 characters. We recommend a mix of letters, numbers, and symbols.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon="📦"
        title="Data & Privacy"
        description="You own your data. Export or delete it anytime."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExportCsv} disabled={busy} className="btn-secondary">
            {busy ? "Exporting…" : "Export Collection (CSV)"}
          </button>
          <button type="button" disabled className="btn-secondary opacity-60">
            Download All Images (Coming Soon)
          </button>
          <button type="button" disabled className="btn-secondary opacity-60">
            Request Full Data Export (Coming Soon)
          </button>
        </div>
      </SectionCard>

      <SectionCard
        icon="⚠️"
        title="Danger Zone"
        description="This action is permanent and cannot be undone."
        className="border-rose-300 bg-rose-50"
      >
        <div className="space-y-3">
          <p className="text-sm text-rose-800">Deleting your account will permanently remove:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-rose-700">
            <li>Your collection</li>
            <li>Uploaded images</li>
            <li>Transaction history</li>
            <li>Location tracking</li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="flex-1 rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-zinc-900"
            />
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="btn-destructive"
            >
              {deleting ? "Deleting…" : "Delete Account"}
            </button>
          </div>
        </div>
      </SectionCard>

      <footer className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>{appVersion}</span>
          <a className="btn-link text-xs" href="mailto:support@thebinder.app">
            support@thebinder.app
          </a>
          <Link className="btn-link text-xs" href="/terms">
            Terms of Service
          </Link>
          <Link className="btn-link text-xs" href="/privacy">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
