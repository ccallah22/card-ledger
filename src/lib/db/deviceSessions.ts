"use client";

import { createClient } from "@/lib/supabase/client";

const TABLE = "device_sessions";
const DEVICE_ID_KEY = "thebinder.deviceId.v1";

export type DeviceSession = {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "server";

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const next = randomId();
  window.localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function currentDeviceName() {
  if (typeof navigator === "undefined") return "Unknown Device";

  const ua = navigator.userAgent || "";
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Android")) return "Android Device";
  if (ua.includes("Macintosh")) return "Mac";
  if (ua.includes("Windows")) return "Windows PC";
  return "Web Device";
}

export async function heartbeatDeviceSession() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return;

  const now = new Date().toISOString();
  const deviceId = getOrCreateDeviceId();

  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: user.id,
      device_id: deviceId,
      device_name: currentDeviceName(),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      last_seen_at: now,
      revoked_at: null,
    },
    {
      onConflict: "user_id,device_id",
    }
  );

  if (error) throw error;
}

export async function listMyDeviceSessions() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return [] as DeviceSession[];

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DeviceSession[];
}

export async function revokeOtherDeviceSessions() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return;

  const now = new Date().toISOString();
  const currentId = getOrCreateDeviceId();

  const { error } = await supabase
    .from(TABLE)
    .update({ revoked_at: now })
    .eq("user_id", user.id)
    .neq("device_id", currentId)
    .is("revoked_at", null);

  if (error) throw error;
}
