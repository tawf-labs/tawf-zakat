import { keccak256, encodePacked, type Hex } from "viem";

export interface DisbursementMetadata {
  beneficiaryName: string;
  beneficiaryNIKMasked: string;
  beneficiaryHash: Hex;
  asnafCategory: string;
  amount: number;
  currency: "IDR" | "USDC";
  description: string;
  timestamp: string;
  evidenceFiles: {
    fileName: string;
    fileType: string;
    description: string;
  }[];
}

export function computeBeneficiaryHash(nik: string, name: string, secretSalt: string): Hex {
  return keccak256(
    encodePacked(
      ["string", "string", "string"],
      [nik, name, secretSalt]
    )
  );
}

export async function uploadDisbursementProofToIPFS(
  metadata: DisbursementMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  const pinataJWT = process.env.PINATA_JWT;

  if (pinataJWT) {
    try {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pinataJWT}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: {
            name: `zakat-disbursement-${metadata.beneficiaryHash.slice(0, 10)}.json`,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          cid: data.IpfsHash,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        };
      }
    } catch (e) {
      console.warn("Pinata upload failed, falling back to deterministic CID generation", e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;

  return {
    cid: mockCID,
    gatewayUrl: `https://ipfs.io/ipfs/${mockCID}`,
  };
}

export interface ProposalDossierMetadata {
  programTitle: string;
  asnafCategory: number;
  asnafLabel: string;
  amount: number;
  currency: "IDR" | "USDC";
  disguisedName: string;
  locationCity: string;
  beneficiaryHash: Hex;
  beneficiaryNIKMasked: string;
  assessmentSummary: string;
  timestamp: string;
  evidenceFiles?: {
    fileName: string;
    fileType: string;
    description: string;
  }[];
}

export async function uploadProposalDossierToIPFS(
  metadata: ProposalDossierMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  const pinataJWT = process.env.PINATA_JWT;

  if (pinataJWT) {
    try {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pinataJWT}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: {
            name: `zakat-proposal-${metadata.beneficiaryHash.slice(0, 10)}.json`,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          cid: data.IpfsHash,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        };
      }
    } catch (e) {
      console.warn("Pinata upload failed, falling back to deterministic CID generation", e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;

  return {
    cid: mockCID,
    gatewayUrl: `https://ipfs.io/ipfs/${mockCID}`,
  };
}

export interface DisbursementReceiptMetadata {
  proposalId: number;
  programTitle: string;
  asnafCategory: number;
  asnafLabel: string;
  beneficiaryName: string;
  beneficiaryNIKMasked: string;
  beneficiaryHash: Hex;
  disbursedAmount: number;
  currency: "IDR" | "USDC";
  disbursementChannel: "BANK_TRANSFER" | "USDC_ONCHAIN" | "CASH_DIRECT";
  bankReferenceNumber?: string;
  bastDocumentCID?: string;
  photoEvidenceCID?: string;
  executedTxHash?: string;
  timestamp: string;
  signedByAmil: string;
}

export async function uploadDisbursementReceiptToIPFS(
  metadata: DisbursementReceiptMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  const pinataJWT = process.env.PINATA_JWT;

  if (pinataJWT) {
    try {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pinataJWT}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: {
            name: `zakat-disbursement-bast-prop-${metadata.proposalId}.json`,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          cid: data.IpfsHash,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        };
      }
    } catch (e) {
      console.warn("Pinata BAST upload failed, falling back to deterministic CID generation", e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;

  return {
    cid: mockCID,
    gatewayUrl: `https://ipfs.io/ipfs/${mockCID}`,
  };
}

export interface AuditReportMetadata {
  proposalId: number;
  programTitle: string;
  beneficiaryHash: string;
  disbursedAmount: number;
  currency: string;
  asnafLabel: string;
  bankReferenceNumber?: string;
  preApprovalDossierCID: string;
  disbursementBastCID: string;
  auditorName: string;
  auditorAddress: string;
  auditOpinion: "WTP" | "WDP" | "DISPUTED" | "CLEAN";
  auditNotes: string;
  auditStandard: string; // e.g. "PSAK 109 / SAS 109 & BAZNAS Sharia Compliance"
  auditorSignature?: string;
  auditTxHash?: string;
  auditCertCID?: string;
  timestamp: string;
}

export async function uploadAuditReportToIPFS(
  metadata: AuditReportMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  const pinataJWT = process.env.PINATA_JWT;

  if (pinataJWT) {
    try {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pinataJWT}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: {
            name: `zakat-audit-report-prop-${metadata.proposalId}.json`,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          cid: data.IpfsHash,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        };
      }
    } catch (e) {
      console.warn("Pinata Audit Report upload failed, falling back to deterministic CID generation", e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `QmAudit${mockCIDHash.slice(2, 44)}`;

  return {
    cid: mockCID,
    gatewayUrl: `https://ipfs.io/ipfs/${mockCID}`,
  };
}
