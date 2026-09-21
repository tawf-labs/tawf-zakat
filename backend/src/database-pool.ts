const defaults = {
  DATABASE_POOL_MAX: 10,
  WORKSPACE_DATABASE_POOL_MAX: 5,
} as const;

/**
 * Per-process, per-pool caps: canonical decimal integers from 1 through 100.
 * Only an absent setting uses the historical default. The upper bound guards
 * against typos; operators must still budget across processes and rolling deploys.
 * With both settings at 2, API (2 + 2) plus indexer (2) can use 6 connections,
 * or 12 while two complete releases overlap. This is not a global DB limit.
 */
export function databasePoolMaxFromEnvironment(
  name: keyof typeof defaults,
  env: Record<string, string | undefined> = process.env,
): number {
  const value = env[name];
  if (value === undefined) return defaults[name];
  const max = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || String(max) !== value || !Number.isSafeInteger(max) || max > 100) {
    throw new Error(`${name} must be a decimal integer between 1 and 100.`);
  }
  return max;
}
