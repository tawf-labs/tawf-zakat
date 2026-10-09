import postgres from "postgres";

export interface CrowdfundingState {
  users: Record<string, any>;
  sessions: Record<string, { userId: string; expiresAt: number }>;
  campaigns: Record<string, any>;
  payments: Record<string, any>;
  outbox: Record<string, any>;
  outboxLease?: { owner: string; expiresAt: number };
  attempts: Record<string, { count: number; until: number }>;
}
export const emptyCrowdfundingState = (): CrowdfundingState => ({ users: {}, sessions: {}, campaigns: {}, payments: {}, outbox: {}, attempts: {} });
export interface CrowdfundingStore {
  transaction<T>(fn: (state: CrowdfundingState) => T | Promise<T>): Promise<T>;
}
export interface AggregateDatabase {
  transaction<T>(fn: (tx: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T>;
}
/** One locked aggregate is intentionally modest throughput, but atomic across processes. */
export function createCrowdfundingStore(database: AggregateDatabase): CrowdfundingStore {
  return { transaction: fn => database.transaction(async tx => {
    const result = await tx.query("SELECT state FROM crowdfunding_state WHERE id = 1 FOR UPDATE");
    if (!result.rows[0]) throw new Error("Crowdfunding migration required");
    const state = result.rows[0].state as CrowdfundingState;
    const value = await fn(state);
    // Bind serialized JSON as text: postgres.js otherwise JSON-encodes the string
    // again when PostgreSQL infers a jsonb parameter (PGlite does not).
    await tx.query("UPDATE crowdfunding_state SET state = $1::text::jsonb WHERE id = 1", [JSON.stringify(state)]);
    return value;
  }) };
}
export function crowdfundingPostgres(url: string) {
  const sql = postgres(url, { max: 2 });
  const database: AggregateDatabase = {
    transaction: async fn => await sql.begin(async tx => fn({ query: async (text, params = []) => ({ rows: Array.from(await tx.unsafe(text, params)) }) })) as any,
  };
  return { store: createCrowdfundingStore(database), sql };
}
export function crowdfundingStoreFromEnv(): CrowdfundingStore | null {
  // Never read any configured production database during test imports.
  if (process.env.NODE_ENV === "test" || !process.env.CROWDFUNDING_DATABASE_URL) return null;
  return crowdfundingPostgres(process.env.CROWDFUNDING_DATABASE_URL).store;
}
