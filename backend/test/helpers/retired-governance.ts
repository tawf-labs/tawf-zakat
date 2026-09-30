import { expect } from "bun:test";
import app from "../../src/index";
import { dataStore } from "../../src/store";

export async function expectRetired(path: string, body: unknown = {}) {
  const before = structuredClone([...dataStore.proposals]);
  const response = await app.fetch(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  expect(response.status).toBe(404);
  expect([...dataStore.proposals]).toEqual(before);
}
