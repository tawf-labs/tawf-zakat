/**
 * The rows of a raw `execute` result. Drizzle's postgres-js driver answers an
 * array; PGlite and node-postgres answer `{ rows }`. New stores import this
 * rather than carrying another private copy.
 */
export const rowsOf = (result: unknown): any[] =>
  Array.isArray(result) ? result : Array.isArray((result as { rows?: unknown })?.rows) ? (result as { rows: any[] }).rows : [];
