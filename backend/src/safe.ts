export interface SafeInfo {
  address: string;
  nonce: string;
  threshold: number;
  owners: string[];
  masterCopy: string;
  version: string;
}

export interface SafePendingTransaction {
  safeTxHash: string;
  to: string;
  value: string;
  data: string | null;
  operation: number;
  nonce: number;
  submissionDate: string;
  isExecuted: boolean;
  confirmationsRequired: number;
  confirmationsCount: number;
  confirmedSigners: string[];
  isReadyToExecute: boolean;
}

const DEFAULT_SAFE_ADDRESS =
  process.env.SAFE_DPS_ADDRESS || "0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1";
const SAFE_API_KEY = process.env.SAFE_API_KEY;

export async function getSafeInfo(safeAddress: string = DEFAULT_SAFE_ADDRESS): Promise<SafeInfo> {
  const url = `https://safe-transaction-sepolia.safe.global/api/v1/safes/${safeAddress}/`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (SAFE_API_KEY) {
      headers["Authorization"] = `Bearer ${SAFE_API_KEY}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        address: data.address || safeAddress,
        nonce: data.nonce?.toString() || "0",
        threshold: data.threshold || 1,
        owners: data.owners || [],
        masterCopy: data.masterCopy || "",
        version: data.version || "1.4.1",
      };
    }
  } catch (err) {
    console.warn("Failed to fetch Safe info from Sepolia API, falling back to local defaults:", err);
  }

  return {
    address: safeAddress,
    nonce: "0",
    threshold: 2,
    owners: [
      "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
      "0xa405eefba6b7795f28a6ca2cb3fb55bdafbb6a4efba7b7b9e047f113f4a28d61",
    ],
    masterCopy: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    version: "1.4.1+L2",
  };
}

export async function getSafePendingTransactions(
  safeAddress: string = DEFAULT_SAFE_ADDRESS
): Promise<{ pendingTransactions: SafePendingTransaction[]; safeThreshold: number }> {
  const url = `https://safe-transaction-sepolia.safe.global/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false`;

  const safeInfo = await getSafeInfo(safeAddress);
  const threshold = safeInfo.threshold;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (SAFE_API_KEY) {
      headers["Authorization"] = `Bearer ${SAFE_API_KEY}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (response.ok) {
      const data = await response.json();
      const results = data.results || [];

      const pendingTransactions: SafePendingTransaction[] = results.map((tx: any) => {
        const confirmations = tx.confirmations || [];
        const confirmedSigners = confirmations.map((c: any) => c.owner);
        const confirmationsCount = confirmations.length;

        return {
          safeTxHash: tx.safeTxHash,
          to: tx.to,
          value: tx.value,
          data: tx.data,
          operation: tx.operation,
          nonce: tx.nonce,
          submissionDate: tx.submissionDate,
          isExecuted: tx.isExecuted || false,
          confirmationsRequired: tx.confirmationsRequired || threshold,
          confirmationsCount,
          confirmedSigners,
          isReadyToExecute: confirmationsCount >= (tx.confirmationsRequired || threshold),
        };
      });

      return {
        pendingTransactions,
        safeThreshold: threshold,
      };
    }
  } catch (err) {
    console.warn("Failed to fetch pending multisig transactions from Safe API:", err);
  }

  return {
    pendingTransactions: [],
    safeThreshold: threshold,
  };
}

export async function getSafeTransactionDetails(safeTxHash: string) {
  const url = `https://safe-transaction-sepolia.safe.global/api/v1/multisig-transactions/${safeTxHash}/`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (SAFE_API_KEY) {
      headers["Authorization"] = `Bearer ${SAFE_API_KEY}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        safeTxHash: data.safeTxHash,
        isExecuted: Boolean(data.isExecuted),
        confirmationsRequired: data.confirmationsRequired || 2,
        confirmationsCount: data.confirmations?.length || 0,
        transactionHash: data.transactionHash || null,
        confirmations: data.confirmations || [],
      };
    }
  } catch (err) {
    console.warn("Failed to fetch safe tx details:", err);
  }

  return null;
}

