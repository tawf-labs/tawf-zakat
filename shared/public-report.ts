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
  recording: { state: string }; validator: { outcome: string }; auditor: string;
  files: { total: number; available: number; missing: number; unavailable: number; integrityFailed: number };
  network: { chainId: number; registry: string; name: string; confirmationPolicy: string; requiredConfirmations: number };
  anchor: { transactionHash?: string; authorizationDigest: string; validatorAuthorizationDigest?: string;
    state: string; confirmations: number; requiredConfirmations: number; confirmationPolicy: string;
    blockNumber?: string; blockHash?: string; logIndex?: number } | null;
  trust: string;
};
