"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { uploadCardImages } from "@/lib/cardImages";
import { createCardRow } from "@/lib/cardsDb";

export default function AddCardPage() {
  const [userId, setUserId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [status, setStatus] = useState("have");
  const [paid, setPaid] = useState<string>("");

  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function onSave() {
    setMsg(null);

    if (!userId) {
      setMsg("You must be logged in. Go to /login first.");
      return;
    }
    if (!name.trim()) {
      setMsg("Name is required.");
      return;
    }

    setSaving(true);
    try {
      const cardId = crypto.randomUUID();

      const { frontPath, backPath } = await uploadCardImages({
        userId,
        cardId,
        frontFile: front,
        backFile: back,
      });

      await createCardRow({
        id: cardId,
        userId,
        name: name.trim(),
        status,
        paid: paid ? Number(paid) : null,
        imageFrontPath: frontPath,
        imageBackPath: backPath,
      });

      setMsg("Saved!");
      setName("");
      setPaid("");
      setFront(null);
      setBack(null);
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Add Card</h1>

      <p style={{ marginTop: 8 }}>{userId ? "Logged in ✅" : "Not logged in ❌ (go to /login)"}</p>

      <label style={{ display: "block", marginTop: 12 }}>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          placeholder="2020 Prizm Justin Herbert Rookie..."
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
        >
          <option value="have">Have</option>
          <option value="want">Want</option>
          <option value="in_transit">In Transit</option>
          <option value="for_sale">For Sale</option>
          <option value="sold">Sold</option>
        </select>
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Paid (optional)
        <input
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          placeholder="25.00"
          inputMode="decimal"
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Front image (optional)
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFront(e.target.files?.[0] ?? null)}
          style={{ width: "100%", marginTop: 6 }}
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Back image (optional)
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setBack(e.target.files?.[0] ?? null)}
          style={{ width: "100%", marginTop: 6 }}
        />
      </label>

      <button onClick={onSave} disabled={saving} style={{ marginTop: 16, padding: "10px 12px" }}>
        {saving ? "Saving..." : "Save Card"}
      </button>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
