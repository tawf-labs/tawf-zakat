/**
 * Two synthetic Pengelola Zakat, with their accounts (Spec #68, ticket #69).
 *
 * They exist so isolation can be proved: one institution cannot demonstrate
 * that another's data stays out of reach. Both are labelled synthetic in the
 * record itself, not only in this comment, so the label travels with the row
 * into the API and the interface.
 *
 * Nothing here is a partner. No name, address, unit or mandate is copied or
 * guessed from an earlier deployment, and none of it is onboarding data: the
 * real institution identities, signatory keys and evidence of mandate are
 * configuration a pilot supplies before real use (ADR-0020).
 *
 * The accounts come from well-known test private keys, published in every
 * Ethereum toolchain, and are therefore worthless as credentials - which is
 * exactly what a fixture account should be. They must never be onboarded onto
 * a deployment holding real data.
 */

import type { InstitutionRecord } from "../tenancy-store";
import type { WorkspaceRole } from "../tenancy";

const SYNTHETIC_MANDATE =
  "Lembaga sintetis untuk pengujian isolasi; bukan mandat atau identitas mitra sungguhan.";

export type SyntheticMember = {
  account: string;
  role: WorkspaceRole;
  /** Which human role this stands for, in the project's own vocabulary. */
  describes: string;
};

export type SyntheticInstitution = InstitutionRecord & { members: SyntheticMember[] };

export const SYNTHETIC_INSTITUTIONS: readonly SyntheticInstitution[] = [
  {
    id: "lpz-sinar-amanah",
    legalName: "LPZ Sinar Amanah (sintetis)",
    scopeUnit: "Pusat",
    scopeLevel: "PUSAT",
    mandateNote: SYNTHETIC_MANDATE,
    isSynthetic: true,
    members: [
      {
        account: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        role: "ADMIN",
        describes: "Administrator lembaga",
      },
      {
        account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        role: "OFFICER",
        describes: "Amil operasional",
      },
      {
        account: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
        role: "READER",
        describes: "Pembaca berwenang",
      },
    ],
  },
  {
    id: "lpz-baitul-maal",
    legalName: "LPZ Baitul Maal Sejahtera (sintetis)",
    scopeUnit: "Pusat",
    scopeLevel: "PUSAT",
    mandateNote: SYNTHETIC_MANDATE,
    isSynthetic: true,
    members: [
      {
        account: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
        role: "ADMIN",
        describes: "Administrator lembaga",
      },
      {
        account: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
        role: "OFFICER",
        describes: "Amil operasional",
      },
    ],
  },
] as const;

/** The record without its accounts, for the institution table itself. */
export const institutionRecordOf = ({ members: _members, ...record }: SyntheticInstitution): InstitutionRecord =>
  record;
