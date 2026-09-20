import { expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestWorkspaceDatabase } from "./helpers/workspace-database";

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("keeps SQL files valid after browser shutdown, GC and database restart", async () => {
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const database = await createTestWorkspaceDatabase();
  try {
    for (let cycle = 0; cycle < 5; cycle++) {
      // Bun 1.3.6 could close these newly reused descriptors when the old
      // Playwright child-process pipes were collected after browser.close().
      await (async () => {
        const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
          headless: true, args: ["--no-sandbox"] });
        try {
          const page = await browser.newPage();
          await page.goto("about:blank");
        } finally { await browser.close(); }
      })();
      const table = sql.identifier(`browser_lifecycle_${cycle}`);
      await database.handle().execute(sql`CREATE TABLE ${table} (value INTEGER NOT NULL)`);
      await database.handle().execute(sql`INSERT INTO ${table} VALUES (${cycle})`);
      Bun.gc(true);
      await Bun.sleep(20); // Allow queued finalizers to run before touching SQL again.
      await database.reopen();
      const result = await database.handle().execute(sql`SELECT value FROM ${table}`);
      expect(("rows" in result ? result.rows : result)[0]?.value).toBe(cycle);
    }
  } finally { await database.close(); }
}, 30000);
