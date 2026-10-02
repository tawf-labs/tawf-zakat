import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceShell } from "./WorkspaceShell";
import { workspaceSections } from "./workspaceNavigation";

const capabilities = { viewWorkspace: true, prepareEvidence: false, manageMembers: false, manageDisbursement: false };

describe("compact workspace navigation", () => {
  it("keeps read-only operational and authority modules reachable", () => {
    expect(workspaceSections(capabilities).map(section => section.id)).toEqual([
      "overview", "contributions", "disbursement", "activities", "certificates", "evidence", "identity",
    ]);
  });
  it("offers member administration only when the API grants it", () => {
    expect(workspaceSections(capabilities).some(section => section.id === "members")).toBe(false);
    expect(workspaceSections({ ...capabilities, manageMembers: true }).some(section => section.id === "members")).toBe(true);
  });
  it("renders only the overview initially, not every private module", () => {
    const rendered: string[] = [];
    const html = renderToStaticMarkup(<WorkspaceShell sections={workspaceSections(capabilities)} institutionName="Lembaga uji" scope="Kota" role="VIEWER" onSignOut={() => {}} renderSection={id => { rendered.push(id); return <p>Konten {id}</p>; }} />);
    expect(rendered).toEqual(["overview"]);
    expect(html).toContain('aria-label="Bagian ruang kerja"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('for="workspace-section"');
    expect(html).not.toContain("Konten contributions");
    expect(html).not.toContain("Petugas &amp; akses");
  });
});
