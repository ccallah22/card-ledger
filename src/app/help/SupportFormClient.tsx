"use client";

import { useState } from "react";

export default function SupportFormClient() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  function updateStatus(next: "idle" | "sending" | "success" | "error", message: string) {
    setStatus(next);
    setStatusMessage(message);
  }

  return (
    <form
      className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        const payload = {
          name: String(formData.get("name") || ""),
          email: String(formData.get("email") || ""),
          message: String(formData.get("message") || ""),
          page: typeof window !== "undefined" ? window.location.href : "",
        };

        updateStatus("sending", "");

        try {
          const res = await fetch("/api/support", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.error || "Failed to send message.");
          }
          form.reset();
          updateStatus("success", "Message sent. We’ll get back to you shortly.");
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to send message.";
          updateStatus("error", message);
        } finally {
          setTimeout(() => updateStatus("idle", ""), 5000);
        }
      }}
    >
      <div className="text-sm font-semibold text-zinc-900">Contact support</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-zinc-600">
          Name
          <input
            name="name"
            type="text"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            placeholder="Your name"
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-600">
          Email *
          <input
            name="email"
            type="email"
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            placeholder="you@email.com"
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs text-zinc-600">
        Message *
        <textarea
          name="message"
          required
          rows={4}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          placeholder="How can we help?"
        />
      </label>
      <button type="submit" className="btn-primary">
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
      {status !== "idle" ? (
        <div
          className={
            "text-xs " +
            (status === "success"
              ? "text-emerald-700"
              : status === "error"
              ? "text-rose-600"
              : "text-zinc-500")
          }
        >
          {statusMessage}
        </div>
      ) : null}
      <div className="text-xs text-zinc-500">
        By submitting, you agree to receive a reply to this email.
      </div>
    </form>
  );
}
