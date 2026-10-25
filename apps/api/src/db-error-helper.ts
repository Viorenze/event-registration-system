/**
 * Runtime structural interface and type guard for Postgres DatabaseError.
 * Does not rely on fragile compile-time `as` or cross-realm `instanceof`.
 * Reference: D3_PLAN.md §6.1.8.
 */
export interface PostgresDatabaseError extends Error {
  code: string;
  constraint?: string;
  column?: string;
  table?: string;
  detail?: string;
  schema?: string;
  severity?: string;
}

export function isPostgresDatabaseError(err: unknown): err is PostgresDatabaseError {
  if (typeof err !== "object" || err === null || !(err instanceof Error)) {
    return false;
  }
  const rec = err as unknown as Record<string, unknown>;
  const hasValidSqlState = typeof rec.code === "string" && /^[0-9A-Z]{5}$/.test(rec.code);
  const isNamedDatabaseError = err.constructor.name === "DatabaseError";
  return hasValidSqlState && (isNamedDatabaseError || "severity" in rec);
}
