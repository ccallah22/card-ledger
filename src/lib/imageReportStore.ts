/**
 * Shared in-memory image-report store used by src/app/api/image-reports/
 * route.ts and its batch/route.ts sibling. Both routes previously defined
 * their own (globally-persisted, via globalThis) copy of this store plus
 * their own slightly-divergent local ReportItem type -- consolidated here
 * so there is exactly one canonical shape and one place the globalThis
 * cast lives.
 *
 * This is a placeholder persistence layer (an in-memory Map, not a
 * database table) -- reports are lost on a full process restart. Kept
 * exactly as-is; this module only removes the duplication and the `any`
 * casts around it, it does not change where or how reports are stored.
 *
 * Backed by globalThis (not a plain module-level variable) so the store
 * survives Next.js dev-server module reloads -- without this, editing
 * either route file in dev would silently reset all in-memory reports.
 */

export type ReportStatus = "active" | "blocked" | "approved";

export type ReportItem = {
  fingerprint: string;
  imageUrl: string;
  reports: number;
  status: ReportStatus;
  reasons: Record<string, number>;
  updatedAt: string;
};

declare global {
  // `declare global` ambient bindings require `var`, not let/const -- not a
  // stylistic choice, and this project's lint config has no active no-var
  // rule to satisfy anyway.
  var __imageReportStore: Map<string, ReportItem> | undefined;
}

export function getImageReportStore(): Map<string, ReportItem> {
  if (!globalThis.__imageReportStore) {
    globalThis.__imageReportStore = new Map<string, ReportItem>();
  }
  return globalThis.__imageReportStore;
}
