import { useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HandCoins,
  LayoutDashboard,
  LogOut,
  MapPin,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceSection, WorkspaceSectionId } from "./workspaceNavigation";

const icons: Record<WorkspaceSectionId, LucideIcon> = {
  overview: LayoutDashboard,
  contributions: Wallet,
  disbursement: HandCoins,
  activities: ClipboardCheck,
  certificates: BadgeCheck,
  evidence: FileText,
  identity: UserRound,
  members: Users,
};

export function WorkspaceShell({
  sections,
  institutionName,
  scope,
  role,
  officerName,
  onSignOut,
  renderSection,
  banner,
}: {
  sections: WorkspaceSection[];
  institutionName: string;
  scope: string;
  role: string;
  officerName?: string;
  onSignOut: () => void;
  renderSection: (id: WorkspaceSectionId, navigate: (id: WorkspaceSectionId) => void) => ReactNode;
  banner?: ReactNode;
}) {
  const [selected, setSelected] = useState<WorkspaceSectionId>("overview");
  const [visited, setVisited] = useState<WorkspaceSectionId[]>(["overview"]);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = sections.find((section) => section.id === selected) ?? sections[0]!;
  const groups = [...new Set(sections.map((section) => section.group))];

  function navigate(id: WorkspaceSectionId) {
    if (!sections.some((section) => section.id === id)) return;
    setSelected(id);
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
    requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
      {/* Desktop Sidebar */}
      <aside
        className="hidden w-[280px] shrink-0 rounded-3xl border border-[#dbe7dd] bg-white/95 shadow-sm shadow-[#17332c]/5 backdrop-blur-md lg:sticky lg:top-20 lg:flex lg:flex-col lg:h-[calc(100vh-6rem)] lg:self-start overflow-hidden"
        aria-label="Menu ruang kerja"
      >
        {/* Institution Header Card */}
        <div className="shrink-0 relative border-b border-[#dbe7dd] bg-gradient-to-b from-[#f7faf8] to-white p-5">
          <div className="flex items-start gap-3.5">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#17332c] to-[#1b765e] text-[#c4ed70] shadow-md shadow-[#17332c]/15 ring-1 ring-[#c5a869]/30">
              <Building2 className="h-6 w-6" aria-hidden="true" />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-white bg-emerald-500"></span>
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                  Terverifikasi
                </span>
                <span className="inline-flex items-center rounded-full border border-[#dbe7dd] bg-[#f4f8f3] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#17332c]">
                  {role}
                </span>
              </div>
              <h3 className="mt-2 font-serif text-base font-bold leading-snug text-[#17332c] line-clamp-2" title={institutionName}>
                {institutionName}
              </h3>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-stone-500">
                <MapPin className="h-3 w-3 shrink-0 text-[#1b765e]" aria-hidden="true" />
                <span className="truncate">{scope}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Links with smooth scroll-y */}
        <nav
          aria-label="Bagian ruang kerja"
          className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4 sidebar-scroll overscroll-contain"
        >
          {groups.map((group) => (
            <div key={group}>
              <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 first:pt-0">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">
                  {group}
                </span>
                <div className="h-px flex-1 bg-stone-100" />
              </div>
              <div className="mt-1 space-y-1">
                {sections
                  .filter((section) => section.group === group)
                  .map((section) => {
                    const Icon = icons[section.id];
                    const isCurrent = active.id === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={() => navigate(section.id)}
                        className={`group relative flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b765e] focus-visible:ring-offset-2 ${
                          isCurrent
                            ? "bg-gradient-to-r from-[#17332c] via-[#1b4339] to-[#17332c] font-semibold text-white shadow-sm shadow-[#17332c]/20"
                            : "font-medium text-stone-600 hover:bg-[#f4f8f3] hover:text-[#17332c]"
                        }`}
                      >
                        {isCurrent && (
                          <span
                            className="absolute -left-1 top-2 bottom-2 w-1.5 rounded-r-full bg-[#c4ed70] shadow-xs shadow-[#c4ed70]/60"
                            aria-hidden="true"
                          />
                        )}

                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 ${
                              isCurrent
                                ? "bg-white/15 text-[#c4ed70] shadow-inner"
                                : "bg-stone-100/80 text-[#1b765e] group-hover:bg-[#eaf3e8] group-hover:text-[#17332c]"
                            }`}
                          >
                            <Icon
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110"
                            />
                          </span>
                          <span className="truncate">{section.label}</span>
                        </div>

                        {isCurrent ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#c4ed70]" aria-hidden="true" />
                        ) : (
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-stone-300 opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:text-stone-500 group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {/* Officer & Sign Out Footer */}
        <div className="shrink-0 border-t border-[#dbe7dd] bg-gradient-to-b from-white to-[#f9fbf9] p-4">
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-2.5 transition-colors hover:border-[#1b765e]/30">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1b765e] to-[#17332c] text-white font-semibold text-xs shadow-2xs">
              {officerName ? officerName.charAt(0).toUpperCase() : <UserRound className="h-4 w-4 text-[#c4ed70]" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-semibold text-stone-800">
                  {officerName || "Profil Petugas"}
                </p>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Sesi aktif" />
              </div>
              <p className="truncate text-[11px] text-stone-500">
                {officerName ? "Petugas Operasional" : "Sesi terbatas"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="group flex min-h-[40px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200/90 bg-white px-3 py-2 text-xs font-semibold text-stone-600 shadow-2xs transition-all duration-150 hover:border-red-200 hover:bg-red-50/80 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <LogOut className="h-3.5 w-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden="true" />
            <span>Keluar ruang kerja</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 space-y-5 pb-8">
        {banner}
        {/* Mobile Navigation Header & Switcher */}
        <div className="rounded-3xl border border-[#dbe7dd] bg-white p-4 shadow-sm lg:hidden space-y-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#17332c] to-[#1b765e] text-[#c4ed70]">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-[#17332c] truncate">{institutionName}</p>
                <div className="flex items-center gap-1.5 text-xs text-stone-500 mt-0.5">
                  <span className="font-semibold text-[#1b765e]">{role}</span>
                  <span>·</span>
                  <span className="truncate">{officerName || "Profil Petugas"}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b765e]"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Keluar</span>
            </button>
          </div>

          {/* Mobile Horizontal Quick-Chip Navigation */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar -mx-1 px-1">
            {sections.map((section) => {
              const Icon = icons[section.id];
              const isCurrent = active.id === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => navigate(section.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-[#17332c] text-white shadow-xs"
                      : "border border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isCurrent ? "text-[#c4ed70]" : "text-[#1b765e]"}`} aria-hidden="true" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>

          {/* Accessible Category Dropdown (Retains test assertion and full grouping accessibility) */}
          <div className="pt-1 border-t border-stone-100">
            <label htmlFor="workspace-section" className="mb-1.5 block text-xs font-medium text-stone-600">
              Bagian ruang kerja
            </label>
            <div className="relative">
              <select
                id="workspace-section"
                value={active.id}
                onChange={(event) => navigate(event.target.value as WorkspaceSectionId)}
                className="min-h-11 w-full appearance-none rounded-xl border border-[#dbe7dd] bg-[#f4f8f3] px-3.5 py-2 text-sm font-medium text-[#17332c] shadow-2xs focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-[#1b765e]/20"
              >
                {groups.map((group) => (
                  <optgroup key={group} label={group}>
                    {sections
                      .filter((section) => section.group === group)
                      .map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-stone-500">
                <ChevronRight className="h-4 w-4 rotate-90" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>

        {/* Content Section Header */}
        <header className="rounded-3xl border border-[#dbe7dd] bg-white p-5 sm:p-6 shadow-sm shadow-[#17332c]/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-500">
              <span className="text-stone-400">Ruang kerja</span>
              <span className="text-stone-300">/</span>
              <span className="inline-flex items-center rounded-md bg-[#eaf3e8] px-2 py-0.5 text-[11px] font-bold text-[#1b765e]">
                {active.group}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-stone-50 px-2.5 py-0.5 text-[11px] font-medium text-stone-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>Aktif</span>
            </div>
          </div>

          <h2
            ref={heading}
            id="workspace-section-title"
            tabIndex={-1}
            className="mt-2.5 scroll-mt-36 font-serif text-2xl font-bold tracking-tight text-[#17332c] sm:text-3xl focus:outline-none"
          >
            {active.label}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-600 max-w-2xl">{active.description}</p>
        </header>

        {/* Dynamic Panels */}
        {sections
          .filter((section) => visited.includes(section.id))
          .map((section) => (
            <div
              key={section.id}
              hidden={active.id !== section.id}
              inert={active.id !== section.id}
              role="region"
              aria-label={section.label}
              className="min-w-0 space-y-4"
            >
              {renderSection(section.id, navigate)}
            </div>
          ))}
      </div>
    </div>
  );
}

export function WorkspaceShortcut({ section, onClick }: { section: WorkspaceSection; onClick: () => void }) {
  const Icon = icons[section.id];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-24 cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-[#dbe7dd] bg-white p-4.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1b765e]/40 hover:bg-gradient-to-br hover:from-white hover:to-[#f4f8f3] hover:shadow-md hover:shadow-[#17332c]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b765e] focus-visible:ring-offset-2"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#eaf3e8] to-[#d8ebd5] text-[#1b765e] shadow-2xs transition-transform duration-200 group-hover:scale-105 group-hover:bg-[#17332c] group-hover:text-[#c4ed70]">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-[#17332c] transition-colors group-hover:text-[#1b765e]">
          {section.label}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-stone-600 line-clamp-2">
          {section.description}
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-400 transition-all duration-200 group-hover:bg-[#1b765e] group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );
}
