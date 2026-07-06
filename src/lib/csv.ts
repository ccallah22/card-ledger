import type { MyCard } from "./repositories/myCards";

function esc(s: unknown): string {
  const v = (s ?? "").toString();
  // CSV escaping
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function cardsToCsv(cards: MyCard[]) {
  const headers = [
    "id",
    "playerName",
    "year",
    "setName",
    "cardNumber",
    "team",

    "location",

    "gradingStatus",
    "condition",
    "grader",
    "grade",
    "certNumber",
    "status",
    "purchasePrice",
    "estimatedValue",
    "purchaseDate",

    // pricing / outcomes
    "askingPrice",
    "soldPrice",
    "soldDate",
    "soldFees",
    "soldNotes",

    // collector fields
    "variation",
    "insert",
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

    c.location ?? "",

    c.gradingStatus,
    c.condition ?? "",
    c.grader ?? "",
    c.grade ?? "",
    c.certNumber ?? "",
    c.status ?? "",

    c.purchasePrice ?? "",
    c.estimatedValue ?? "",
    c.purchaseDate ?? "",

    c.askingPrice ?? "",
    c.soldPrice ?? "",
    c.soldDate ?? "",
    c.soldFees ?? "",
    c.soldNotes ?? "",

    c.variation ?? "",
    c.insert ?? "",
    c.parallel ?? "",
    c.serialNumber ?? "",
    c.serialTotal ?? "",
    c.isRookie ? "true" : "",
    c.isAutograph ? "true" : "",
    c.isPatch ? "true" : "",

    c.notes ?? "",

    c.createdAt ?? "",
    c.updatedAt ?? "",
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
