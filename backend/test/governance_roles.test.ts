import { expect, it } from "bun:test";
import { GOVERNANCE_ROLE_HASHES } from "../src/governance-roles";
import { KNOWN_ROLES } from "../src/indexer";
import { GOVERNANCE_ROLES } from "../../frontend/src/lib/contracts";

it("keeps the Solidity DPS and auditor role hashes distinct and correctly named", () => {
  expect(GOVERNANCE_ROLE_HASHES.SHARIA_SUPERVISOR_ROLE).toBe("0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c");
  expect(GOVERNANCE_ROLE_HASHES.AUDITOR_ROLE).toBe("0x59a1c48e5837ad7a7f3dcedcbe129bf3249ec4fbf651fd4f5e2600ead39fe2f5");
  for (const [name, hash] of Object.entries(GOVERNANCE_ROLE_HASHES)) expect(KNOWN_ROLES[hash]).toBe(name);
  expect(Object.entries(GOVERNANCE_ROLES).sort()).toEqual(Object.entries(GOVERNANCE_ROLE_HASHES).sort());
});
