import { keccak256, encodePacked, type Hex } from "viem";

export const PINATA_DEDICATED_GATEWAY = "https://white-lazy-marten-351.mypinata.cloud/ipfs";
export const PUBLIC_IPFS_GATEWAY = "https://ipfs.io/ipfs";

export function getIpfsGatewayUrl(cid: string, preferredGateway = PINATA_DEDICATED_GATEWAY): string {
  if (!cid) return "";
  const cleanCid = cid.replace(/^ipfs:\/\//, "");
  return `${preferredGateway}/${cleanCid}`;
}

export function computeBeneficiaryHash(nik: string, name: string, secretSalt: string): Hex {
  return keccak256(
    encodePacked(
      ["string", "string", "string"],
      [nik, name, secretSalt]
    )
  );
}

/**
 * Upload binary file (PDF, JPG, PNG) to Pinata IPFS via multipart pinFileToIPFS
 */
export async function uploadFileToIPFS(
  file: Blob | File | Buffer | Uint8Array,
  fileName: string,
  mimeType = "application/octet-stream"
): Promise<{ cid: string; gatewayUrl: string; pinSize: number }> {
  const pinataJWT = process.env.PINATA_JWT;

  if (pinataJWT) {
    try {
      const formData = new FormData();
      const fileBlob = file instanceof Blob ? file : new Blob([file], { type: mimeType });
      formData.append("file", fileBlob, fileName);
      formData.append(
        "pinataMetadata",
        JSON.stringify({
          name: fileName,
          keyvalues: {
            app: "zakat-protocol-l1",
            uploadedAt: new Date().toISOString(),
          },
        })
      );

      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pinataJWT}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        return {
          cid: data.IpfsHash,
          gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${data.IpfsHash}`,
          pinSize: data.PinSize || 0,
        };
      } else {
        const errText = await response.text();
        console.error("Pinata pinFileToIPFS HTTP error:", response.status, errText);
        throw new Error(`Pinata file upload failed: HTTP ${response.status}`);
      }
    } catch (e: any) {
      console.warn("Pinata binary file upload failed:", e.message || e);
      if (process.env.NODE_ENV !== "test") {
        throw new Error(`Gagal mengunggah berkas ke IPFS Pinata: ${e.message || "Network error"}`);
      }
    }
  }

  // Fallback for isolated unit tests without network access
  const mockContent = file instanceof Blob ? await file.text() : file.toString();
  const mockCIDHash = keccak256(encodePacked(["string", "string"], [fileName, mockContent]));
  const mockCID = `QmFile${mockCIDHash.slice(2, 44)}`;

  return {
    cid: mockCID,
    gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${mockCID}`,
    pinSize: mockContent.length,
  };
}

// In-memory store for instant lookup and tests
export const mockIpfsStore = new Map<string, { content: string | object; mimeType: string }>();

export interface AttachmentItem {
  name: string;
  fileType: string;
  cid: string;
  description?: string;
  url?: string;
}

export interface LocationData {
  province: string;
  regencyCity: string;
  district?: string;
}

export interface ShariaComplianceChecks {
  asnafVerified: boolean;
  amilCapCompliant: boolean;
  antiDoubleClaimPassed: boolean;
  notes?: string;
}

export interface DisbursementMetadata {
  schemaVersion?: string;
  docType?: "DISBURSEMENT_PROOF";
  beneficiaryName: string;
  beneficiaryNIKMasked: string;
  beneficiaryHash: Hex;
  asnafCategory: string;
  amount: number;
  currency: "IDR" | "USDC";
  description: string;
  timestamp: string;
  location?: LocationData;
  shariaComplianceChecks?: ShariaComplianceChecks;
  attachments?: AttachmentItem[];
  evidenceFiles?: {
    fileName: string;
    fileType: string;
    description: string;
    fileCID?: string;
  }[];
}

export async function uploadDisbursementProofToIPFS(
  metadata: DisbursementMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  metadata.schemaVersion = metadata.schemaVersion || "1.1.0";
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
        mockIpfsStore.set(data.IpfsHash, { content: metadata, mimeType: "application/json" });
        return {
          cid: data.IpfsHash,
          gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${data.IpfsHash}`,
        };
      } else {
        const errText = await response.text();
        console.error("Pinata pinJSONToIPFS error:", response.status, errText);
      }
    } catch (e: any) {
      console.warn("Pinata upload failed:", e.message || e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;
  mockIpfsStore.set(mockCID, { content: metadata, mimeType: "application/json" });

  return {
    cid: mockCID,
    gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${mockCID}`,
  };
}

export interface ProposalDossierMetadata {
  schemaVersion?: string;
  docType?: "PROPOSAL_DOSSIER";
  programTitle: string;
  asnafCategory: number;
  asnafLabel: string;
  amount: number;
  currency: "IDR" | "USDC";
  disguisedName: string;
  locationCity: string;
  location?: LocationData;
  beneficiaryHash: Hex;
  beneficiaryNIKMasked: string;
  assessmentSummary: string;
  shariaComplianceChecks?: ShariaComplianceChecks;
  attachments?: AttachmentItem[];
  timestamp: string;
  evidenceFiles?: {
    fileName: string;
    fileType: string;
    description: string;
    fileCID?: string;
  }[];
}

export async function uploadProposalDossierToIPFS(
  metadata: ProposalDossierMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  metadata.schemaVersion = metadata.schemaVersion || "1.1.0";
  metadata.docType = metadata.docType || "PROPOSAL_DOSSIER";
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
        mockIpfsStore.set(data.IpfsHash, { content: metadata, mimeType: "application/json" });
        return {
          cid: data.IpfsHash,
          gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${data.IpfsHash}`,
        };
      } else {
        const errText = await response.text();
        console.error("Pinata proposal upload error:", response.status, errText);
        if (process.env.NODE_ENV !== "test") {
          throw new Error(`Gagal mengunggah berkas proposal ke IPFS: HTTP ${response.status}`);
        }
      }
    } catch (e: any) {
      console.warn("Pinata upload failed:", e.message || e);
      if (process.env.NODE_ENV !== "test") {
        throw new Error(`Gagal memproses unggahan proposal ke IPFS Pinata: ${e.message || "Network timeout"}`);
      }
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;
  mockIpfsStore.set(mockCID, { content: metadata, mimeType: "application/json" });

  return {
    cid: mockCID,
    gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${mockCID}`,
  };
}

export interface DisbursementReceiptMetadata {
  schemaVersion?: string;
  docType?: "BAST_RECEIPT";
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
  location?: LocationData;
  shariaComplianceChecks?: ShariaComplianceChecks;
  attachments?: AttachmentItem[];
  timestamp: string;
  signedByAmil: string;
}

export async function uploadDisbursementReceiptToIPFS(
  metadata: DisbursementReceiptMetadata
): Promise<{ cid: string; gatewayUrl: string }> {
  metadata.schemaVersion = metadata.schemaVersion || "1.1.0";
  metadata.docType = metadata.docType || "BAST_RECEIPT";
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
        mockIpfsStore.set(data.IpfsHash, { content: metadata, mimeType: "application/json" });
        return {
          cid: data.IpfsHash,
          gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${data.IpfsHash}`,
        };
      }
    } catch (e: any) {
      console.warn("Pinata upload failed:", e.message || e);
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;
  mockIpfsStore.set(mockCID, { content: metadata, mimeType: "application/json" });

  return {
    cid: mockCID,
    gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${mockCID}`,
  };
}

export async function inspectIpfsCid(cid: string): Promise<{
  cid: string;
  mimeType: string;
  isJson: boolean;
  data: any;
  gatewayUsed: string;
  rawContent?: string;
}> {
  const cleanCid = cid.replace(/^ipfs:\/\//, "");

  // 1. Check local mock memory store first
  if (mockIpfsStore.has(cleanCid)) {
    const item = mockIpfsStore.get(cleanCid)!;
    const isJson = typeof item.content === "object" || item.mimeType.includes("json");
    return {
      cid: cleanCid,
      mimeType: item.mimeType,
      isJson,
      data: isJson ? (typeof item.content === "string" ? JSON.parse(item.content) : item.content) : null,
      rawContent: typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2),
      gatewayUsed: "local-mock-gateway",
    };
  }

  // 2. Gateway cascade
  const gateways = [
    PINATA_DEDICATED_GATEWAY,
    "https://cloudflare-ipfs.com/ipfs",
    PUBLIC_IPFS_GATEWAY,
    "https://dweb.link/ipfs",
  ];

  for (const gw of gateways) {
    try {
      const url = `${gw}/${cleanCid}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "application/octet-stream";
        if (contentType.includes("json")) {
          const json = await res.json();
          mockIpfsStore.set(cleanCid, { content: json, mimeType: contentType });
          return {
            cid: cleanCid,
            mimeType: contentType,
            isJson: true,
            data: json,
            gatewayUsed: gw,
          };
        } else {
          return {
            cid: cleanCid,
            mimeType: contentType,
            isJson: false,
            data: null,
            gatewayUsed: gw,
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback if network fails
  return {
    cid: cleanCid,
    mimeType: "application/json",
    isJson: true,
    data: {
      schemaVersion: "1.1.0",
      cid: cleanCid,
      status: "UNRESOLVED_OFFLINE",
      message: "Dokumen tidak dapat dijangkau dari gateway IPFS publik saat ini.",
    },
    gatewayUsed: "fallback",
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
          gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${data.IpfsHash}`,
        };
      } else {
        const errText = await response.text();
        console.error("Pinata Audit Report upload error:", response.status, errText);
        if (process.env.NODE_ENV !== "test") {
          throw new Error(`Gagal mengunggah laporan audit ke IPFS: HTTP ${response.status}`);
        }
      }
    } catch (e: any) {
      console.warn("Pinata Audit Report upload failed:", e.message || e);
      if (process.env.NODE_ENV !== "test") {
        throw new Error(`Gagal memproses unggahan laporan audit ke IPFS Pinata: ${e.message || "Network timeout"}`);
      }
    }
  }

  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `QmAudit${mockCIDHash.slice(2, 44)}`;

  return {
    cid: mockCID,
    gatewayUrl: `${PINATA_DEDICATED_GATEWAY}/${mockCID}`,
  };
}
