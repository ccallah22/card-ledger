"use client";

import * as Sentry from "@sentry/nextjs";

export function startTrace(name: string) {
  try {
    const span = Sentry.startInactiveSpan({ name, op: "ui.action" });
    if (span && typeof (span as { end?: () => void }).end === "function") {
      return () => (span as { end: () => void }).end();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  try {
    Sentry.captureException(error, { extra: context });
  } catch {
    // ignore
  }
}
