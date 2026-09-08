import { z } from "zod";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const authorityChangeInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SIGNATORY"), account: address, active: z.boolean() }).strict(),
  z.object({ action: z.literal("AUDITOR"), account: address, active: z.boolean(), mandate: z.string().max(2000) }).strict(),
  z.object({ action: z.literal("VALIDATOR"), account: address, active: z.boolean() }).strict(),
  z.object({ action: z.literal("PROPOSE_ADMINISTRATOR"), account: address }).strict(),
  z.object({ action: z.literal("ACCEPT_ADMINISTRATOR") }).strict(),
  z.object({ action: z.literal("PROPOSE_VALIDATOR_OPERATOR"), account: address }).strict(),
  z.object({ action: z.literal("ACCEPT_VALIDATOR_OPERATOR") }).strict(),
]);
export type AuthorityChange = z.infer<typeof authorityChangeInput>;
