import type { SportsCard } from "./types";

function esc(s: unknown): string {
  const v = (s ?? "").toString();
  // CSV escaping
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function cardsToCsv(cards: SportsCard[]) {
  const headers = [
    "id",
    "playerName",
    "year",
    "setName",
    "cardNumber",
    "team",

    // ✅ NEW
    "location",

    "condition",
    "grader",
    "grade",
    "status",
    "purchasePrice",
    "marketValue",
    "purchaseDate",

    // pricing / outcomes
    "askingPrice",
    "soldPrice",
    "soldDate",
    "soldFees",
    "soldNotes",

    // collector fields
    "variation",
    "parallel",
    "serialNumber",
    "serialTotal",
    "isRookie",
    "isAutograph",
    "isPatch",

    "notes",

    // timestamps
    "createdAt",
    "updatedAt",
  ];

  const rows = cards.map((c) => [
    c.id,
    c.playerName,
    c.year,
    c.setName,
    c.cardNumber ?? "",
    c.team ?? "",

    // ✅ NEW
    c.location ?? "",

    c.condition,
    c.grader ?? "",
    c.grade ?? "",
    c.status ?? "",

    c.purchasePrice ?? "",
    (c as any).marketValue ?? "",
    c.purchaseDate ?? "",

    (c as any).askingPrice ?? "",
    (c as any).soldPrice ?? "",
    (c as any).soldDate ?? "",
    (c as any).soldFees ?? "",
    (c as any).soldNotes ?? "",

    (c as any).variation ?? "",
    (c as any).parallel ?? "",
    (c as any).serialNumber ?? "",
    (c as any).serialTotal ?? "",
    (c as any).isRookie ? "true" : "",
    (c as any).isAutograph ? "true" : "",
    (c as any).isPatch ? "true" : "",

    c.notes ?? "",

    (c as any).createdAt ?? "",
    (c as any).updatedAt ?? "",
  ]);

  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
