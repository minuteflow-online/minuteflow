"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ClientAdminOverview from "@/components/ClientAdminOverview";
import ClientLiveTeamMonitor from "@/components/ClientLiveTeamMonitor";
import ClientScreenshotsPanel from "@/components/ClientScreenshotsPanel";
import ClientOrgTeamPanel from "@/components/ClientOrgTeamPanel";
import ClientOrgTasksPanel from "@/components/ClientOrgTasksPanel";
import ClientAssignTaskPanel from "@/components/ClientAssignTaskPanel";
import { getTimezoneAbbr } from "@/lib/utils";

/*
 * The client's Admin page, in the same shell as the real Admin panel
 * ((admin)/admin/page.tsx): dark sidebar with an ADMIN / TEAM switch, grouped
 * tabs with the same icons, a "Back to Dashboard" foot, and a content area
 * headed by the tab's name. A client only gets the tabs that exist for their
 * own team; everything inside is scoped to their org by the client-admin
 * routes.
 */

type ClientAdminTab = "overview" | "screenshots" | "team" | "task_assignments";
type Section = "admin" | "team";

// Icons copied from the real Admin panel's SIDEBAR_TABS so the two match.
const TABS: Record<ClientAdminTab, { label: string; subtitle: string; icon: React.ReactNode }> = {
  overview: {
    label: "Overview",
    subtitle: "Monitor your team's activity",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  screenshots: {
    label: "Screenshots",
    subtitle: "View your team's screenshots on your tasks",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  team: {
    label: "Team Management",
    subtitle: "Manage your co-admins, VAs, and their team roles",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  task_assignments: {
    label: "Task Assignments",
    subtitle: "Assign tasks to your VAs and track their progress",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
};

type Group = { id: string; label?: string; tabs: ClientAdminTab[] };

const GROUPS: Record<Section, Group[]> = {
  admin: [
    { id: "pinned", tabs: ["overview"] },
    { id: "activity", label: "Activity", tabs: ["screenshots"] },
  ],
  team: [{ id: "team", label: "Team", tabs: ["team", "task_assignments"] }],
};

const SECTION_OF: Record<ClientAdminTab, Section> = {
  overview: "admin",
  screenshots: "admin",
  team: "team",
  task_assignments: "team",
};

export default function ClientAdminPage() {
  const [activeTab, setActiveTab] = useState<ClientAdminTab>("overview");
  const [section, setSection] = useState<Section>("admin");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["activity", "team"]));
  const [refreshKey, setRefreshKey] = useState(0);
  const [timezone, setTimezone] = useState("UTC");
  const [clock, setClock] = useState("");

  useEffect(() => {
    fetch("/api/client-admin/team-context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => {
        if (d?.timezone) setTimezone(d.timezone);
      })
      .catch(() => {});
  }, []);

  // Same clock as the real Admin panel's sidebar.
  useEffect(() => {
    function updateClock() {
      setClock(
        new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }) +
          " " +
          getTimezoneAbbr(timezone)
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  const openTab = (tab: ClientAdminTab) => {
    setActiveTab(tab);
    setSection(SECTION_OF[tab]);
  };

  const switchSection = (next: Section) => {
    setSection(next);
    const first = GROUPS[next].flatMap((g) => g.tabs)[0];
    if (first && SECTION_OF[activeTab] !== next) setActiveTab(first);
  };

  const tabButton = (tab: ClientAdminTab, nested: boolean) => {
    const isActive = activeTab === tab;
    return (
      <button
        key={tab}
        onClick={() => openTab(tab)}
        className={`w-full flex items-center gap-2.5 rounded-lg px-3 ${nested ? "py-2 pl-4" : "py-2.5"} text-left text-[13px] font-medium transition-all cursor-pointer ${
          isActive ? "bg-terracotta text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
      >
        {TABS[tab].icon}
        <span className="flex-1">{TABS[tab].label}</span>
      </button>
    );
  };

  return (
    <div className="flex min-h-[calc(100vh-69px)]">
      {/* ── Left Sidebar (same as the real Admin panel) ── */}
      <aside className="w-[220px] shrink-0 bg-[#3d2b1f] flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white tracking-wide">Admin Panel</h2>
          <p className="mt-0.5 text-[10px] text-white/50">{clock}</p>
          <div className="mt-3 flex rounded-lg bg-black/25 p-0.5">
            {(["admin", "team"] as const).map((s) => (
              <button
                key={s}
                onClick={() => switchSection(s)}
                className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
                  section === s ? "bg-terracotta text-white shadow-sm" : "text-white/50 hover:text-white/80"
                }`}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex-1 py-2 px-2 overflow-y-auto">
          {GROUPS[section].map((group) => {
            if (!group.label) return group.tabs.map((tab) => tabButton(tab, false));

            const isExpanded = expanded.has(group.id);
            const hasActiveTab = group.tabs.includes(activeTab);
            return (
              <div key={group.id} className="mt-2">
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    hasActiveTab && !isExpanded
                      ? "text-terracotta hover:bg-white/10"
                      : "text-white/40 hover:text-white/70 hover:bg-white/5"
                  }`}
                >
                  <span className="flex-1">{group.label}</span>
                  <svg
                    className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isExpanded && <div className="mt-0.5 space-y-0.5">{group.tabs.map((tab) => tabButton(tab, true))}</div>}
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/10">
          <Link
            href="/client"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div className="flex-1 min-w-0 bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-2xl font-bold text-espresso">{TABS[activeTab].label}</h1>
              <p className="mt-0.5 text-[13px] text-bark">{TABS[activeTab].subtitle}</p>
            </div>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="px-3 py-1.5 rounded-lg border border-sand bg-white text-[11px] font-semibold text-walnut hover:border-terracotta hover:text-terracotta transition-colors"
            >
              ↻ Refresh
            </button>
          </div>

          {activeTab === "overview" && (
            <div className="space-y-6">
              <ClientAdminOverview refreshKey={refreshKey} />
              <ClientLiveTeamMonitor key={refreshKey} />
            </div>
          )}
          {activeTab === "screenshots" && <ClientScreenshotsPanel key={refreshKey} />}
          {activeTab === "team" && <ClientOrgTeamPanel key={refreshKey} />}
          {activeTab === "task_assignments" && (
            <div className="space-y-5">
              <ClientAssignTaskPanel onAssigned={() => setRefreshKey((k) => k + 1)} />
              <ClientOrgTasksPanel key={refreshKey} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
