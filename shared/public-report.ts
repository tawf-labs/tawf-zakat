export type PublicVersionEntry = {
  packageId: string; versionReference: string; official: boolean; predecessorPackageId: string | null;
  commitment: string; policy: string; outcome: string;
  endorsements: { institution: string; validator: string };
  /** Institution-authored free text stays restricted; the public line carries only that a reason exists. */
  correctionReason: "TERBATAS_BAGI_PEMBACA_BERWENANG" | null;
  anchor: { transactionHash?: string; state: string; blockNumber: string | null; blockHash: string | null;
    logIndex: number | null; blockTimestamp: string | null; confirmations: number; requiredConfirmations: number } | null;
  attestations: PublicAttestations;
};
export type PublicAttestations = {
  state: string; count: number; basis: string;
  /** A fixed vocabulary recorded on chain, so a public reader sees the actual conclusion. */
  entries: { id: string; auditor: string; scope: string; conclusion: string; evidenceCommitment: string;
    predecessor: string | null; mandate: string }[];
};
export type PublicReportSummary = {
  content: {
    format: string; formatVersion: number; packageId: string;
    institution: { id: string; name: string; synthetic: boolean };
    period: { kind: string; year: number };
    scope: { kind: string; balanceSheet: string; currencyUnit: string; levels: string[]; fundTypes: string[] };
    sources: { role: string; origin: string; cutOff: string; transactionDetail: string; status: string }[];
    reportReference: string; versionReference: string; publicationAuthorizationDigest: string;
    commitment: string; commitmentScheme: string; policy: string;
    findings: { counts: Record<string, number>; netDelta: { amount: string; unit: string } | null; absoluteDelta: { amount: string; unit: string } | null };
    tolerance: { amount: string; unit: string }; limitations: string[];
  };
  summaryDigest: string;
  publication: { state: string; observation: unknown };
  /** Which version identity this summary is, and whether a later correction has taken over. */
  version: { state: string; predecessorPackageId: string | null; supersededByPackageId: string | null;
    officialPackageId: string | null; officialVersionReference: string | null };
  history: PublicVersionEntry[];
  recording: { state: string }; validator: { outcome: string }; auditor: string;
  attestations: PublicAttestations;
  files: { total: number; available: number; missing: number; unavailable: number; integrityFailed: number };
  network: { chainId: number; registry: string; name: string; confirmationPolicy: string; requiredConfirmations: number };
  anchor: { transactionHash?: string; authorizationDigest: string; validatorAuthorizationDigest?: string;
    state: string; confirmations: number; requiredConfirmations: number; confirmationPolicy: string;
    blockNumber?: string; blockHash?: string; logIndex?: number } | null;
  trust: string;
};
