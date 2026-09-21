import { describe, expect, it } from "bun:test";
import { databasePoolMaxFromEnvironment } from "../src/database-pool";

const names = ["DATABASE_POOL_MAX", "WORKSPACE_DATABASE_POOL_MAX"] as const;

describe("bounded PostgreSQL pool configuration", () => {
  it("preserves legacy defaults only when the setting is absent", () => {
    expect(databasePoolMaxFromEnvironment("DATABASE_POOL_MAX", {})).toBe(10);
    expect(databasePoolMaxFromEnvironment("WORKSPACE_DATABASE_POOL_MAX", {})).toBe(5);
  });

  it("accepts explicit positive integers including both bounds", () => {
    for (const name of names) {
      for (const value of ["1", "2", "5", "10", "30", "99", "100"]) {
        expect(databasePoolMaxFromEnvironment(name, { [name]: value })).toBe(Number(value));
      }
    }
  });

  it("keeps API/indexer ledger and workspace limits independent", () => {
    const env = { DATABASE_POOL_MAX: "2", WORKSPACE_DATABASE_POOL_MAX: "3" };
    expect(databasePoolMaxFromEnvironment("DATABASE_POOL_MAX", env)).toBe(2);
    expect(databasePoolMaxFromEnvironment("WORKSPACE_DATABASE_POOL_MAX", env)).toBe(3);
    expect(databasePoolMaxFromEnvironment("WORKSPACE_DATABASE_POOL_MAX", { DATABASE_POOL_MAX: "2" })).toBe(5);
    expect(databasePoolMaxFromEnvironment("DATABASE_POOL_MAX", { WORKSPACE_DATABASE_POOL_MAX: "2" })).toBe(10);
  });

  for (const name of names) {
    it(`rejects malformed or out-of-bounds ${name} without echoing values`, () => {
      for (const value of [
        "", " ", "\t", "0", "00", "01", "-1", "+2", "1.5", "2.0", "NaN", "Infinity",
        "2junk", "2 3", " 2", "2 ", "2\n", "2\r\n", "0x10", "1e1", "101", "1000",
        "9007199254740993", "9".repeat(400), "private-configuration-value",
      ]) {
        expect(() => databasePoolMaxFromEnvironment(name, { [name]: value }))
          .toThrow(`${name} must be a decimal integer between 1 and 100.`);
      }
    });
  }
});
