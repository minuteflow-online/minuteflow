"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import VAProjectsTab from "@/components/VAProjectsTab";
import RecurringTemplatesManager from "@/components/RecurringTemplatesManager";
import type { RecurringTaskTemplate, UserRole } from "@/types/database";

type TeamMember = { id: string; full_name: string; username: string; role?: string; position?: string };
type FormObjective = { id: number; account: string | null; project_name: string };
type FormTask = { id: number; task_name: string };

export default function ProductivityOperationsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("va");
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [ready, setReady] = useState(false);

  const [view, setView] = useState<"tree" | "recurring">("tree");

  // "" = my own templates (default), "all" = everyone's, a VA's id = just theirs.
  // Only admin-tier roles ever see the selector that changes this.
  const [templatesViewMode, setTemplatesViewMode] = useState<string>("");

  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [formTasksByProject, setFormTasksByProject] = useState<Record<number, FormTask[]>>({});

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setReady(true);
        return;
      }
      setUserId(user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole((profile?.role as UserRole) || "va");

      const { data: org } = await supabase.from("organization_settings").select("timezone").limit(1).single();
      if (org?.timezone) setOrgTimezone(org.timezone);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/task-form-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.accounts?.length > 0) setFormAccounts(d.accounts);
        if (d.projects?.length > 0) setFormProjects(d.projects);
        if (d.tasksByProject) setFormTasksByProject(d.tasksByProject);
      })
      .catch(() => {});
  }, []);

  const isAdminTier = hasBroadAdminAccess({ role });

  const fetchRecurringTemplates = useCallback(async () => {
    if (!userId) return;
    setRecurringLoading(true);
    try {
      const params = new URLSearchParams();
      // Non-admins always get their own — the selector below never renders
      // for them, so templatesViewMode stays at its "" default anyway, but
      // this keeps the query correct even if that ever changes.
      if (!isAdminTier || templatesViewMode === "") params.set("mine", "true");
      else if (templatesViewMode !== "all") params.set("viewAsVa", templatesViewMode);
      const res = await fetch(`/api/recurring-task-templates?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRecurringTemplates((d.templates ?? []) as RecurringTaskTemplate[]);
    } catch {
      setRecurringTemplates([]);
    } finally {
      setRecurringLoading(false);
    }
  }, [userId, isAdminTier, templatesViewMode]);

  useEffect(() => {
    if (view === "recurring") void fetchRecurringTemplates();
  }, [view, fetchRecurringTemplates]);

  const projectTagsMap: Record<string, string[]> = {};
  for (const p of formProjects) {
    const key = p.account ?? "";
    if (!projectTagsMap[key]) projectTagsMap[key] = [];
    projectTagsMap[key].push(p.project_name);
  }

  if (!ready || !userId) {
    return <div className="p-8 text-center text-xs text-stone">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setView("tree")}
            className={`rounded-md px-3 py-1.5 transition-colors ${view === "tree" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
          >
            Operations
          </button>
          <button
            type="button"
            onClick={() => setView("recurring")}
            className={`rounded-md px-3 py-1.5 transition-colors ${view === "recurring" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
          >
            Recurring Templates
          </button>
        </div>

        {/* Admin-tier only — VAs always see just their own templates, same
            as the default "My View" here, so the selector would do nothing
            for them. */}
        {isAdminTier && view === "recurring" && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-stone whitespace-nowrap">View:</span>
            <select
              value={templatesViewMode}
              onChange={(e) => setTemplatesViewMode(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            >
              <option value="">My View</option>
              <option value="all">Everyone</option>
              {teamMembers
                .filter((m) => m.id !== userId && m.role === "va" && m.position !== "Admin")
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
            </select>
          </div>
        )}
      </div>

      {view === "tree" ? (
        <VAProjectsTab kind="operation" activeProfiles={teamMembers} currentUserId={userId} isAdmin={isAdminTier} />
      ) : (
        <RecurringTemplatesManager
          templates={recurringTemplates}
          loading={recurringLoading}
          activeProfiles={teamMembers}
          profilesLoaded={teamMembers.length > 0}
          orgTimezone={orgTimezone}
          accountOptions={formAccounts}
          projectTagsMap={projectTagsMap}
          formObjectives={formProjects}
          formTasksByObjective={formTasksByProject}
          assignedByOptions={teamMembers}
          onRefresh={fetchRecurringTemplates}
          currentUserId={userId}
          vaMode={!isAdminTier}
        />
      )}
    </div>
  );
}
