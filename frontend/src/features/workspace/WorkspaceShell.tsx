import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, Building2, ClipboardCheck, FileCheck2, FileText, HandCoins, LayoutDashboard, ShieldCheck, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import type { WorkspaceSection, WorkspaceSectionId } from "./workspaceNavigation";

const icons: Record<WorkspaceSectionId, LucideIcon> = {
  overview: LayoutDashboard, contributions: Wallet, disbursement: HandCoins, activities: ClipboardCheck,
  certificates: BadgeCheck, evidence: FileText, audit: FileCheck2, identity: UserRound, members: Users, authority: ShieldCheck,
};

export function WorkspaceShell({ sections, institutionName, scope, role, officerName, onSignOut, renderSection }: {
  sections: WorkspaceSection[]; institutionName: string; scope: string; role: string; officerName?: string;
  onSignOut: () => void;
  renderSection: (id: WorkspaceSectionId, navigate: (id: WorkspaceSectionId) => void) => ReactNode;
}) {
  const [selected, setSelected] = useState<WorkspaceSectionId>("overview");
  const [visited, setVisited] = useState<WorkspaceSectionId[]>(["overview"]);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = sections.find(section => section.id === selected) ?? sections[0]!;
  const groups = [...new Set(sections.map(section => section.group))];

  function navigate(id: WorkspaceSectionId) {
    if (!sections.some(section => section.id === id)) return;
    setSelected(id);
    setVisited(current => current.includes(id) ? current : [...current, id]);
    requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    });
  }

  return <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
    <aside className="hidden overflow-y-auto rounded-2xl border border-[#dbe7dd] bg-white lg:sticky lg:top-36 lg:block lg:max-h-[calc(100dvh-10rem)]" aria-label="Menu ruang kerja">
      <div className="border-b border-[#dbe7dd] p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#17332c] text-[#c4ed70]"><Building2 className="h-5 w-5" aria-hidden="true" /></div>
        <p className="break-words text-sm font-semibold text-[#17332c]">{institutionName}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-stone-600">{scope}</p>
        <span className="mt-3 inline-flex rounded-md border border-[#dbe7dd] bg-[#f4f8f3] px-2 py-1 text-[11px] font-semibold text-[#17332c]">{role}</span>
      </div>
      <nav aria-label="Bagian ruang kerja" className="space-y-4 p-3">
        {groups.map(group => <div key={group}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">{group}</p>
          <div className="space-y-1">{sections.filter(section => section.group === group).map(section => {
            const Icon = icons[section.id];
            return <button key={section.id} type="button" aria-current={active.id === section.id ? "page" : undefined}
              onClick={() => navigate(section.id)}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b765e] ${active.id === section.id ? "bg-[#17332c] font-semibold text-white" : "text-stone-700 hover:bg-[#f4f8f3] hover:text-[#17332c]"}`}>
              <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${active.id === section.id ? "text-[#c4ed70]" : "text-[#1b765e]"}`} />{section.label}
            </button>;
          })}</div>
        </div>)}
      </nav>
      <div className="border-t border-[#dbe7dd] p-4">
        <p className="truncate text-xs font-medium text-stone-700">{officerName || "Profil petugas belum tersedia"}</p>
        <button type="button" onClick={onSignOut} className="mt-2 min-h-11 w-full cursor-pointer rounded-lg border border-stone-200 px-3 text-left text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-[#1b765e]">Keluar ruang kerja</button>
      </div>
    </aside>

    <div className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-[#dbe7dd] bg-white p-4 lg:hidden">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="break-words text-sm font-semibold text-[#17332c]">{institutionName}</p><p className="mt-1 text-xs text-stone-600">{role} · {officerName || "Profil belum tersedia"}</p></div>
          <button type="button" onClick={onSignOut} className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-stone-200 px-3 text-xs font-semibold text-stone-700 focus-visible:outline-2 focus-visible:outline-[#1b765e]">Keluar</button>
        </div>
        <label htmlFor="workspace-section" className="mb-1.5 block text-xs font-medium text-stone-600">Bagian ruang kerja</label>
        <select id="workspace-section" value={active.id} onChange={event => navigate(event.target.value as WorkspaceSectionId)}
          className="min-h-11 w-full rounded-xl border border-[#dbe7dd] bg-[#f4f8f3] px-3 text-base font-medium text-[#17332c] focus:outline-2 focus:outline-[#1b765e]">
          {groups.map(group => <optgroup key={group} label={group}>{sections.filter(section => section.group === group).map(section => <option key={section.id} value={section.id}>{section.label}</option>)}</optgroup>)}
        </select>
      </div>
      <header className="rounded-2xl border border-[#dbe7dd] bg-white px-5 py-4 sm:px-6">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1b765e]">Ruang kerja / {active.group}</p>
        <h2 ref={heading} id="workspace-section-title" tabIndex={-1} className="scroll-mt-36 text-xl font-semibold text-[#17332c] focus:outline-none">{active.label}</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">{active.description}</p>
      </header>
      {/* First visit mounts a panel. Hiding it retains drafts; the parent session key clears them on identity changes. */}
      {sections.filter(section => visited.includes(section.id)).map(section => <div key={section.id} hidden={active.id !== section.id} inert={active.id !== section.id}
        role="region" aria-label={section.label} className="min-w-0 space-y-4">
        {renderSection(section.id, navigate)}
      </div>)}
    </div>
  </div>;
}

export function WorkspaceShortcut({ section, onClick }: { section: WorkspaceSection; onClick: () => void }) {
  const Icon = icons[section.id];
  return <button type="button" onClick={onClick} className="group flex min-h-24 cursor-pointer items-center gap-4 rounded-2xl border border-[#dbe7dd] bg-white p-4 text-left transition-colors hover:border-[#1b765e] hover:bg-[#f4f8f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b765e]">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eaf3e8] text-[#1b765e]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#17332c]">{section.label}</span><span className="mt-1 block text-xs leading-relaxed text-stone-600">{section.description}</span></span>
    <ArrowUpRight className="h-4 w-4 shrink-0 text-stone-500 group-hover:text-[#1b765e]" aria-hidden="true" />
  </button>;
}
