// Mobile Add UX: transient, module-level handoff for the File captured by
// the center mobile Add button's own hidden file input (AppShell.tsx)
// before it navigates to /cards/new?mode=scan. A File object can't survive
// a URL/query-param handoff, and there's no existing client store in this
// project to reuse, so this is a small purpose-built slot rather than a
// general store: it holds at most one pending File, is consumed exactly
// once via takePendingScanImage() (which clears the slot on read, so a
// direct /cards/new visit or a second read -- e.g. a React Strict Mode
// double-invoked effect -- finds nothing pending), and never persists
// across a reload (plain in-memory module state, not localStorage/DB).
let pendingFile: File | null = null;

export function setPendingScanImage(file: File): void {
  pendingFile = file;
}

export function takePendingScanImage(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}

// Same-route follow-up: if the center Add button is tapped while already on
// /cards/new, a router.push to the same URL doesn't remount the page, so
// the mount-time consumer never runs. AppShell dispatches this window
// CustomEvent (after setPendingScanImage) as a same-page "a new pending
// scan is ready" signal instead of navigating; the event carries no File
// payload -- pendingScanImage remains the single source of truth for the
// File itself, this is only a notification that something is now pending.
export const PENDING_SCAN_IMAGE_EVENT = "cards:pending-scan-image";
