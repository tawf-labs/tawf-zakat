/** Authority management is a wallet transaction, separate from report endorsements. */
export type AuthorityChange =
  | { action: "SIGNATORY" | "VALIDATOR"; account: string; active: boolean }
  | { action: "AUDITOR"; account: string; active: boolean; mandate: string }
  | { action: "PROPOSE_ADMINISTRATOR" | "PROPOSE_VALIDATOR_OPERATOR"; account: string }
  | { action: "ACCEPT_ADMINISTRATOR" | "ACCEPT_VALIDATOR_OPERATOR" };
export function authorityScope(change: AuthorityChange, institution: string): string {
  switch (change.action) {
    case "VALIDATOR": case "PROPOSE_VALIDATOR_OPERATOR": case "ACCEPT_VALIDATOR_OPERATOR": return "GLOBAL_VALIDATOR_SERVICE";
    case "SIGNATORY": case "AUDITOR": case "PROPOSE_ADMINISTRATOR": case "ACCEPT_ADMINISTRATOR": return institution;
  }
}
