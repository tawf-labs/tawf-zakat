import { describe, it, expect } from "bun:test";
import {
  getIpfsGatewayUrl,
  PINATA_DEDICATED_GATEWAY,
  PUBLIC_IPFS_GATEWAY,
  uploadProposalDossierToIPFS,
  uploadDisbursementReceiptToIPFS,
  inspectIpfsCid,
  type ProposalDossierMetadata,
  type DisbursementReceiptMetadata,
} from "../src/ipfs";
import app from "../src/index";

describe("Ticket 01 — Dynamic Metadata Schema v1.1.0 & Backend Inspection Engine", () => {
  it("should create Proposal Dossier metadata matching v1.1.0 schema with multi-attachments and location", async () => {
    const sampleDossier: ProposalDossierMetadata = {
      schemaVersion: "1.1.0",
      docType: "PROPOSAL_DOSSIER",
      programTitle: "Bantuan Modal Usaha Muallaf Mandiri",
      asnafCategory: 4,
      asnafLabel: "Muallaf",
      amount: 5000000,
      currency: "IDR",
      disguisedName: "Ahmad M.",
      locationCity: "Bandung",
      location: {
        province: "Jawa Barat",
        regencyCity: "Kota Bandung",
        district: "Coblong",
      },
      beneficiaryHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      beneficiaryNIKMasked: "3273************",
      assessmentSummary: "Mustahik membutuhkan alat usaha warung kelontong",
      shariaComplianceChecks: {
        asnafVerified: true,
        amilCapCompliant: true,
        antiDoubleClaimPassed: true,
        notes: "Syarat muallaf telah diverifikasi ustadz pembina",
      },
      attachments: [
        {
          name: "sktm_kelurahan.pdf",
          fileType: "application/pdf",
          cid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
          description: "Surat Keterangan Tidak Mampu dari Kelurahan",
          url: `${PINATA_DEDICATED_GATEWAY}/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco`,
        },
        {
          name: "foto_tempat_usaha.jpg",
          fileType: "image/jpeg",
          cid: "QmPhoto1234567890abcdef1234567890abcdef123456",
          description: "Foto survei fisik lokasi usaha",
          url: `${PINATA_DEDICATED_GATEWAY}/QmPhoto1234567890abcdef1234567890abcdef123456`,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const { cid, gatewayUrl } = await uploadProposalDossierToIPFS(sampleDossier);
    expect(cid).toBeDefined();
    expect(gatewayUrl).toContain(cid);
  });

  it("should create BAST Disbursement Receipt metadata with multi-channel and bank references", async () => {
    const sampleBast: DisbursementReceiptMetadata = {
      schemaVersion: "1.1.0",
      docType: "BAST_RECEIPT",
      proposalId: 42,
      programTitle: "Penyaluran Zakat Paket Sembako Fakir",
      asnafCategory: 1,
      asnafLabel: "Fakir",
      beneficiaryName: "Hamba Allah (Fakir)",
      beneficiaryNIKMasked: "3201************",
      beneficiaryHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      disbursedAmount: 2500000,
      currency: "IDR",
      disbursementChannel: "BANK_TRANSFER",
      bankReferenceNumber: "TRF-BCA-99281726",
      attachments: [
        {
          name: "bast_signed.pdf",
          fileType: "application/pdf",
          cid: "QmBastSigned1234567890abcdef1234567890abcdef",
          description: "Berita Acara Serah Terima ditandatangani Mustahik & Amil",
          url: `${PINATA_DEDICATED_GATEWAY}/QmBastSigned1234567890abcdef1234567890abcdef`,
        },
      ],
      timestamp: new Date().toISOString(),
      signedByAmil: "0x78731D3Ca6b7E34aC0F824c42a7cC18A495cabaB",
    };

    const { cid, gatewayUrl } = await uploadDisbursementReceiptToIPFS(sampleBast);
    expect(cid).toBeDefined();
    expect(gatewayUrl).toContain(cid);
  });

  it("should inspect CID and return parsed metadata with MIME detection via GET /api/ipfs/inspect/:cid", async () => {
    // Generate sample dossier
    const sampleDossier: ProposalDossierMetadata = {
      schemaVersion: "1.1.0",
      docType: "PROPOSAL_DOSSIER",
      programTitle: "Bantuan Beasiswa Santri Yatim",
      asnafCategory: 7,
      asnafLabel: "Fisabilillah",
      amount: 3000000,
      currency: "IDR",
      disguisedName: "Fatimah Z.",
      locationCity: "Surabaya",
      beneficiaryHash: "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
      beneficiaryNIKMasked: "3578************",
      assessmentSummary: "Santri berprestasi dari keluarga kurang mampu",
      timestamp: new Date().toISOString(),
    };

    const { cid } = await uploadProposalDossierToIPFS(sampleDossier);

    const res = await app.fetch(new Request(`http://localhost/api/ipfs/inspect/${cid}`));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.cid).toBe(cid);
    expect(json.mimeType).toBe("application/json");
    expect(json.isJson).toBe(true);
    expect(json.data.schemaVersion).toBe("1.1.0");
    expect(json.data.programTitle).toBe("Bantuan Beasiswa Santri Yatim");
  });
});
