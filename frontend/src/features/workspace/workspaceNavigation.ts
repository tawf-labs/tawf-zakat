import type { Capabilities } from "./workspaceClient";

export type WorkspaceSectionId = "overview" | "contributions" | "disbursement" | "activities" | "certificates" | "evidence" | "audit" | "identity" | "members" | "authority";
export type WorkspaceSection = { id: WorkspaceSectionId; label: string; description: string; group: "Ruang kerja" | "Operasional" | "Bukti & pemeriksaan" | "Pengaturan" };

const sections: WorkspaceSection[] = [
  { id: "overview", label: "Ringkasan", description: "Identitas lembaga, hak akses, dan pintasan pekerjaan Anda.", group: "Ruang kerja" },
  { id: "contributions", label: "Kontribusi", description: "Catat, periksa, dan alokasikan kontribusi donatur.", group: "Operasional" },
  { id: "disbursement", label: "Penyaluran", description: "Kelola program, pengajuan, keputusan, dan realisasi bantuan.", group: "Operasional" },
  { id: "activities", label: "Kegiatan", description: "Telusuri pendanaan dan perkembangan kegiatan lembaga.", group: "Operasional" },
  { id: "certificates", label: "Sertifikat", description: "Terbitkan dan periksa bukti digital kegiatan penyaluran.", group: "Operasional" },
  { id: "evidence", label: "Bukti & laporan", description: "Siapkan bukti, periksa sumber, dan susun paket laporan.", group: "Bukti & pemeriksaan" },
  { id: "audit", label: "Temuan pemeriksaan", description: "Tindak lanjuti temuan dan catatan pemeriksaan laporan.", group: "Bukti & pemeriksaan" },
  { id: "identity", label: "Identitas & mandat", description: "Periksa mandat pribadi dan konteks akun pengesahan lembaga.", group: "Pengaturan" },
  { id: "members", label: "Petugas & akses", description: "Kelola petugas, mandat operasional, dan akun pengesahan lembaga.", group: "Pengaturan" },
  { id: "authority", label: "Otoritas lembaga", description: "Periksa otoritas, riwayat akses, dan perubahan pencatatan publik.", group: "Pengaturan" },
];

/** Navigation never grants a capability; each panel and the API keep their own checks. */
export function workspaceSections(capabilities: Capabilities): WorkspaceSection[] {
  return sections.filter(section => section.id !== "members" || capabilities.manageMembers);
}
