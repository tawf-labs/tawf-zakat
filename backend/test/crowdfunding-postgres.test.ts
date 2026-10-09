import { expect, test } from "bun:test";
import postgres from "postgres";
import { createCrowdfundingStore } from "../src/crowdfunding-store";

// Explicit local opt-in only. Temporary table shadows the application table and
// is discarded when the outer transaction finishes; no existing data is changed.
const url = process.env.CROWDFUNDING_POSTGRES_TEST_URL;
test.skipIf(!url)("real PostgreSQL keeps aggregate JSON as an object across writes and rollback", async () => {
  const target = new URL(url!);
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("Local PostgreSQL required");
  const sql = postgres(url!, { max: 1, connect_timeout: 5 });
  try {
    await sql.begin(async outer => {
      await outer.unsafe("CREATE TEMP TABLE crowdfunding_state (id integer PRIMARY KEY, state jsonb NOT NULL) ON COMMIT DROP");
      await outer.unsafe("INSERT INTO crowdfunding_state VALUES (1, '{\"users\":{},\"sessions\":{},\"campaigns\":{},\"payments\":{},\"outbox\":{},\"attempts\":{}}'::jsonb)");
      const store = createCrowdfundingStore({
        transaction: async fn => await outer.savepoint(async tx => fn({
          query: async (text, params = []) => ({ rows: Array.from(await tx.unsafe(text, params)) }),
        })) as any,
      });
      await store.transaction(s => { s.users.fixture = { id: "fixture" }; });
      const shape = await outer.unsafe("SELECT jsonb_typeof(state) AS kind FROM crowdfunding_state WHERE id = 1");
      expect(shape[0]!.kind).toBe("object");
      expect(await store.transaction(s => s.users.fixture.id)).toBe("fixture");
      await expect(store.transaction(s => { s.users.rollback = {}; throw new Error("rollback"); })).rejects.toThrow("rollback");
      expect(await store.transaction(s => s.users.rollback)).toBeUndefined();
      expect(await store.transaction(s => Object.keys(s.users))).toEqual(["fixture"]);
    });
  } finally {
    await sql.end();
  }
}, 15000);
