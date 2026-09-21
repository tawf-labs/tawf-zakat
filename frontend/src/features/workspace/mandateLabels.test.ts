import { describe, expect, it } from "bun:test";
import { OPERATIONAL_FUNCTIONS } from "../../../../backend/src/operational-mandate";
import { OPERATIONAL_FUNCTION_LABELS } from "./mandateLabels";

describe("mandate labels", () => {
  it("labels every operational function the backend can grant", () => {
    for (const fn of OPERATIONAL_FUNCTIONS) expect(OPERATIONAL_FUNCTION_LABELS[fn]?.label).toBeTruthy();
  });
});
