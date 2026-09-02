import type { CatalogResolutionInput } from "./resolveCatalogTypes";

/**
 * Pure request-body validation for POST /api/catalog/resolve-card. Kept in
 * its own module (no "server-only", no Supabase import) so it's directly
 * unit-testable without a running server, and so a future client caller
 * could reuse the same rules to pre-validate before submitting.
 */

const MAX_SHORT_TEXT = 200;
const MAX_YEAR_LENGTH = 8;
const MAX_SERIAL_TOTAL = 999_999;

export type FieldError = { field: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Required non-empty text, trimmed, length-capped. */
function readRequiredText(
  body: Record<string, unknown>,
  field: string,
  errors: FieldError[],
): string {
  const raw = body[field];
  if (typeof raw !== "string" || !raw.trim()) {
    errors.push({ field, message: "is required and must be a non-empty string" });
    return "";
  }
  if (raw.length > MAX_SHORT_TEXT) {
    errors.push({ field, message: `must be ${MAX_SHORT_TEXT} characters or fewer` });
    return "";
  }
  return raw.trim();
}

/** Optional text: absent/null/undefined is fine; if present, must be a valid string. */
function readOptionalText(
  body: Record<string, unknown>,
  field: string,
  errors: FieldError[],
  maxLength: number = MAX_SHORT_TEXT,
): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    errors.push({ field, message: "must be a string if provided" });
    return null;
  }
  if (raw.length > maxLength) {
    errors.push({ field, message: `must be ${maxLength} characters or fewer` });
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Optional positive integer id (e.g. checklistSectionId). */
function readOptionalPositiveInt(
  body: Record<string, unknown>,
  field: string,
  errors: FieldError[],
): number | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    errors.push({ field, message: "must be a positive integer if provided" });
    return null;
  }
  return raw;
}

/** Optional print-run style number: positive integer, bounded to a sane ceiling. */
function readOptionalSerialTotal(
  body: Record<string, unknown>,
  field: string,
  errors: FieldError[],
): number | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > MAX_SERIAL_TOTAL) {
    errors.push({ field, message: `must be a positive integer up to ${MAX_SERIAL_TOTAL}` });
    return null;
  }
  return raw;
}

function readOptionalBoolean(
  body: Record<string, unknown>,
  field: string,
  errors: FieldError[],
): boolean | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "boolean") {
    errors.push({ field, message: "must be a boolean if provided" });
    return undefined;
  }
  return raw;
}

/**
 * Builds a validated CatalogResolutionInput from an untrusted parsed JSON
 * body. Only the known fields below are ever read -- any other top-level
 * key on the body (unsupported/unexpected fields) is silently ignored
 * rather than rejected, since it can't reach resolveCatalogIds either way
 * (mapped fields are the only ones resolveCatalogIdsServer forwards).
 * Field-level type/length/range violations on a *known* field do reject
 * the whole request with 400, listing every violation found.
 */
export function validateBody(
  body: unknown,
): { input: CatalogResolutionInput } | { errors: FieldError[] } {
  if (!isPlainObject(body)) {
    return { errors: [{ field: "body", message: "must be a JSON object" }] };
  }

  const errors: FieldError[] = [];

  const playerName = readRequiredText(body, "playerName", errors);
  const setName = readRequiredText(body, "setName", errors);
  const year = readOptionalText(body, "year", errors, MAX_YEAR_LENGTH);
  const cardNumber = readOptionalText(body, "cardNumber", errors);
  const catalogCardId = readOptionalPositiveInt(body, "catalogCardId", errors);
  const checklistSectionId = readOptionalPositiveInt(body, "checklistSectionId", errors);
  const swatchDescriptor = readOptionalText(body, "swatchDescriptor", errors);
  const insert = readOptionalText(body, "insert", errors);
  const parallel = readOptionalText(body, "parallel", errors);
  const variation = readOptionalText(body, "variation", errors);
  const serialTotal = readOptionalSerialTotal(body, "serialTotal", errors);
  const isRookie = readOptionalBoolean(body, "isRookie", errors);
  const isAutograph = readOptionalBoolean(body, "isAutograph", errors);
  const isPatch = readOptionalBoolean(body, "isPatch", errors);
  const location = readOptionalText(body, "location", errors);
  const grader = readOptionalText(body, "grader", errors);

  if (errors.length > 0) return { errors };

  return {
    input: {
      playerName,
      setName,
      year,
      cardNumber,
      catalogCardId,
      checklistSectionId,
      swatchDescriptor,
      insert,
      parallel,
      variation,
      serialTotal,
      isRookie,
      isAutograph,
      isPatch,
      location,
      grader,
    },
  };
}
