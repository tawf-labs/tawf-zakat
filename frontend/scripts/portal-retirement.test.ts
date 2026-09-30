import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("supervisor portal retirement", () => {
  it("removes the route and its exclusive governance components", () => {
    expect(existsSync(new URL("../src/routes/tata-kelola.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/features/governance", import.meta.url))).toBe(false);
    expect(source("routeTree.gen.ts")).not.toContain("/tata-kelola");
  });

  it("removes portal links and the unused global governance provider", () => {
    for (const path of ["components/layout/Navbar.tsx", "components/layout/Footer.tsx"]) {
      expect(source(path)).not.toContain("/tata-kelola");
      expect(source(path)).not.toContain("Portal Pengawas");
    }
    expect(source("routes/__root.tsx")).not.toContain("RoleProvider");
  });

  it("preserves the active workspace route, access provider and navigation", () => {
    expect(source("routes/ruang-kerja.tsx")).toContain('createFileRoute("/ruang-kerja")');
    expect(source("routes/ruang-kerja.tsx")).toContain("<WorkspacePanel />");
    expect(source("routes/__root.tsx")).toContain("<RootWorkspaceAccessProvider>");
    expect(source("components/layout/Navbar.tsx")).toContain('to: "/ruang-kerja"');
    expect(source("routeTree.gen.ts")).toContain("/ruang-kerja");
  });
});
