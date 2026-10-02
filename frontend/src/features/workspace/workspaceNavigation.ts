import type { Capabilities } from "./workspaceClient";

export type WorkspaceSectionId = "overview" | "contributions" | "disbursement" | "activities" | "certificates" | "identity" | "members";
export type WorkspaceSection = { id: WorkspaceSectionId; label: string; description: string; group: "Ruang kerja" | "Operasional" | "Pengaturan" };

// Kept in the code but not offered in the MVP workspace (ADR-0039 amendment, 2026-10-02): Temuan pemeriksaan,
// Bukti & laporan (evidence packages and period report publication) and Otoritas lembaga.
const sections: WorkspaceSection[] = [
  { id: "overview", label: "Ringkasan", description: "Identitas lembaga, hak akses, dan pintasan pekerjaan Anda.", group: "Ruang kerja" },
  { id: "contributions", label: "Kontribusi", description: "Catat, periksa, dan alokasikan kontribusi donatur.", group: "Operasional" },
  { id: "disbursement", label: "Penyaluran", description: "Kelola program, pengajuan, keputusan, dan realisasi bantuan.", group: "Operasional" },
  { id: "activities", label: "Kegiatan", description: "Telusuri pendanaan dan perkembangan kegiatan lembaga.", group: "Operasional" },
  { id: "certificates", label: "Sertifikat", description: "Terbitkan dan periksa bukti digital kegiatan penyaluran.", group: "Operasional" },
  { id: "identity", label: "Identitas & mandat", description: "Periksa mandat pribadi dan konteks akun pengesahan lembaga.", group: "Pengaturan" },
  { id: "members", label: "Petugas & akses", description: "Kelola petugas, mandat operasional, dan akun pengesahan lembaga.", group: "Pengaturan" },
];

/** Navigation never grants a capability; each panel and the API keep their own checks. */
export function workspaceSections(capabilities: Capabilities): WorkspaceSection[] {
  return sections.filter(section => section.id !== "members" || capabilities.manageMembers);
}
