// lib/format.ts

type FormatOpts = { accounting?: boolean };

/**
 * Format a number into the user's "native" currency format based on locale.
 * - Uses browser locale (navigator.language)
 * - Picks a reasonable currency by region (lightweight mapping)
 * - Supports accounting style for negatives: (¥1,234) instead of -¥1,234
 */
export function formatCurrency(value: number, opts?: FormatOpts) {
  const accounting = opts?.accounting ?? false;

  const locale =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-US";

  const currency = currencyForLocale(locale);

  const nf = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  });

  const abs = Math.abs(value);
  const formatted = nf.format(abs);

  if (value < 0 && accounting) return `(${formatted})`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Lightweight locale → currency mapping.
 * Expand later if you add a Settings override.
 */
function currencyForLocale(locale: string): string {
  const l = (locale || "").toLowerCase();

  // US
  if (l.startsWith("en-us")) return "USD";

  // English variants
  if (l.startsWith("en-gb")) return "GBP";
  if (l.startsWith("en-ca")) return "CAD";
  if (l.startsWith("en-au")) return "AUD";
  if (l.startsWith("en-nz")) return "NZD";
  if (l.startsWith("en-ie")) return "EUR";

  // Japan / Korea / China
  if (l.startsWith("ja")) return "JPY";
  if (l.startsWith("ko")) return "KRW";
  if (l.startsWith("zh-cn") || l.startsWith("zh-hans")) return "CNY";
  if (l.startsWith("zh-tw") || l.startsWith("zh-hant")) return "TWD";
  if (l.startsWith("zh-hk")) return "HKD";

  // Switzerland / Sweden / Norway / Denmark
  if (l.startsWith("de-ch") || l.startsWith("fr-ch") || l.startsWith("it-ch")) return "CHF";
  if (l.startsWith("sv")) return "SEK";
  if (l.startsWith("nb") || l.startsWith("nn") || l.startsWith("no")) return "NOK";
  if (l.startsWith("da")) return "DKK";

  // Mexico / Brazil
  if (l.startsWith("es-mx")) return "MXN";
  if (l.startsWith("pt-br")) return "BRL";

  // India
  if (l.startsWith("hi") || l.startsWith("en-in")) return "INR";

  // Most EU locales → EUR
  const euStarts = [
    "de", "fr", "es", "it", "nl", "pt", "pl", "cs", "sk", "sl",
    "fi", "et", "lv", "lt", "el", "hr", "hu", "ro", "bg",
  ];
  if (euStarts.some((p) => l.startsWith(p))) return "EUR";

  // Safe default
  return "USD";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Humanizes the time elapsed since an ISO date string into a single
 * "N years" / "N months" / "N days" label -- used for Player Hub's
 * Collection Age (time since the first owned card was added). This is a
 * pure presentation-time formatter, not a derived fact: the underlying
 * date (e.g. PlayerOverview.journey.firstCardAddedDate) is the real,
 * stored value; this only humanizes it relative to "now" at render time,
 * so it's deliberately never precomputed/cached anywhere.
 */
export function formatCollectionAge(sinceIso: string): string {
  const since = new Date(sinceIso).getTime();
  if (!Number.isFinite(since)) return "";

  const days = Math.max(0, Math.floor((Date.now() - since) / DAY_MS));

  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"}`;
}
