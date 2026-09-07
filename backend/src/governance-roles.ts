import { keccak256, toHex, zeroHash } from "viem";

export const GOVERNANCE_ROLE_HASHES = {
  DEFAULT_ADMIN_ROLE: zeroHash,
  SHARIA_SUPERVISOR_ROLE: keccak256(toHex("SHARIA_SUPERVISOR_ROLE")),
  AUDITOR_ROLE: keccak256(toHex("AUDITOR_ROLE")),
  RELAYER_ROLE: keccak256(toHex("RELAYER_ROLE")),
} as const;
