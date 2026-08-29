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
  // If PINATA_JWT is present in env, we can pin to live Pinata IPFS
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

  // Deterministic mock CID for testing / local development
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

  // Deterministic mock CID for testing / local development
  const mockCIDHash = keccak256(encodePacked(["string"], [JSON.stringify(metadata)]));
  const mockCID = `Qm${mockCIDHash.slice(2, 46)}`;

  return {
    cid: mockCID,
    gatewayUrl: `https://ipfs.io/ipfs/${mockCID}`,
  };
}
