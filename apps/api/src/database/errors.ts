/** Postgres error codes the API turns into answers instead of 500s. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = findPgError(error);
  return cause?.code === PG_UNIQUE_VIOLATION && (!constraint || cause.constraint_name === constraint);
}

function findPgError(error: unknown): { code?: string; constraint_name?: string } | null {
  // Drizzle wraps driver errors; the Postgres error is the cause.
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'code' in current && typeof (current as { code: unknown }).code === 'string') {
      return current as { code?: string; constraint_name?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
