"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ProjectTag {
  id: number;
  account: string;
  project_name: string;
  sort_order: number;
  is_active: boolean;
}

export interface QuickActionMapping {
  category: string;
  task_name: string;
  account: string;
  project: string;
  client_name?: string;
}

interface ProjectSidebarProps {
  onSelectProject: (account: string, project: string) => void;
  onQuickAction: (mapping: QuickActionMapping) => void;
  isAdmin: boolean;
}

interface QuickActionConfig {
  label: string;
  action: string;
  icon: string;
  color: string;
  category: string;
  account: string;
  projects: string[]; // 1 = auto-fill, 2+ = VA picks from dropdown
  client_name?: string;
}

const QUICK_ACTIONS: QuickActionConfig[] = [
  { label: "Team Assist", action: "team-assist", icon: "\ud83e\udd1d", color: "bg-terracotta-soft text-terracotta", category: "Collaboration", account: "Virtual Concierge", projects: ["Supervision"] },
  { label: "Support Request", action: "support-request", icon: "\ud83c\udd98", color: "bg-clay-rose-soft text-clay-rose", category: "Collaboration", account: "Virtual Concierge", projects: ["Supervision"] },
  { label: "Training", action: "training", icon: "\ud83d\udcda", color: "bg-clay-rose-soft text-clay-rose", category: "Collaboration", account: "Virtual Concierge", projects: ["1 on 1 Meeting", "Team Meeting"] },
  { label: "Feedback", action: "feedback", icon: "\ud83d\udcac", color: "bg-parchment text-walnut", category: "Collaboration", account: "Virtual Concierge", projects: ["Personal Development", "Team Development"] },
  { label: "Coaching/Review", action: "coaching-review", icon: "\ud83c\udfaf", color: "bg-sage-soft text-sage", category: "Collaboration", account: "Virtual Concierge", projects: ["Personal Development", "Team Development"] },
  { label: "Weekly Meeting", action: "weekly-meeting", icon: "\ud83d\udcc5", color: "bg-slate-blue-soft text-slate-blue", category: "Collaboration", account: "Virtual Concierge", projects: ["1 on 1 Meeting", "Team Meeting"] },
  { label: "Unsched Meeting", action: "unscheduled-meeting", icon: "\ud83d\udde3\ufe0f", color: "bg-amber-soft text-amber", category: "Collaboration", account: "Virtual Concierge", projects: ["1 on 1 Meeting", "Team Meeting"] },
  { label: "Messaging", action: "messaging", icon: "\ud83d\udce8", color: "bg-slate-blue-soft text-slate-blue", category: "Communication", account: "Virtual Concierge", projects: ["Supervision"] },
  { label: "Sorting Tasks", action: "sorting-tasks", icon: "\ud83d\udccb", color: "bg-amber-soft text-amber", category: "Planning", account: "Virtual Concierge", projects: ["Organizing"], client_name: "Toni Colina" },
];

export default function ProjectSidebar({
  onSelectProject,
  onQuickAction,
  isAdmin,
}: ProjectSidebarProps) {
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [allAccounts, setAllAccounts] = useState<string[]>([]);

  const fetchTags = useCallback(async () => {
    const supabase = createClient();
    const [tagsRes, accountsRes] = await Promise.all([
      supabase
        .from("project_tags")
        .select("*")
        .eq("is_active", true)
        .order("account")
        .order("sort_order"),
      supabase
        .from("accounts")
        .select("name")
        .eq("active", true)
        .order("name"),
    ]);
    if (tagsRes.data) setTags(tagsRes.data as ProjectTag[]);
    if (accountsRes.data) setAllAccounts(accountsRes.data.map((a: { name: string }) => a.name));
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Group tags by account
  const grouped = tags.reduce<Record<string, ProjectTag[]>>((acc, tag) => {
    if (!acc[tag.account]) acc[tag.account] = [];
    acc[tag.account].push(tag);
    return acc;
  }, {});

  const toggleAccount = (account: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  };

  const handleDeleteProject = async (tagId: number) => {
    if (!isAdmin) return;
    setDeletingId(tagId);
    const supabase = createClient();
    await supabase
      .from("project_tags")
      .update({ is_active: false })
      .eq("id", tagId);
    setDeletingId(null);
    fetchTags();
  };

  // All active accounts (from DB + any that have projects)
  const accounts = [...new Set([...allAccounts, ...tags.map((t) => t.account)])].sort();

  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-parchment px-4 py-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Quick Pick
        </h3>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {/* Quick Actions */}
        <div className="px-4 py-3 border-b border-parchment">
          <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
            Actions
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.action}
                onClick={() => {
                  // Auto-fill task name, category, account
                  // If single project → also auto-fill project
                  // If multiple projects → leave project empty, VA picks from dropdown
                  onQuickAction({
                    category: qa.category,
                    task_name: qa.label,
                    account: qa.account,
                    project: qa.projects.length === 1 ? qa.projects[0] : "",
                    client_name: qa.client_name,
                  });
                }}
                className={`${qa.color} rounded-lg py-2 px-1 text-center cursor-pointer transition-all hover:opacity-80`}
              >
                <div className="text-sm leading-none mb-0.5">{qa.icon}</div>
                <div className="text-[9px] font-semibold leading-tight">{qa.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Projects by Account */}
        <div className="px-4 py-3">
          <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
            Projects
          </div>
          {accounts.length === 0 ? (
            <p className="text-[11px] text-stone">No projects yet.</p>
          ) : (
            <div className="space-y-1">
              {accounts.map((account) => {
                const projects = grouped[account] || [];
                return (
                <div key={account}>
                  <button
                    onClick={() => projects.length > 0 ? toggleAccount(account) : onSelectProject(account, "")}
                    className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-parchment cursor-pointer transition-colors"
                  >
                    <span className="text-[11px] font-semibold text-espresso">{account}</span>
                    <span className="text-[9px] text-stone">
                      {projects.length > 0 ? `${expandedAccounts.has(account) ? "\u25bc" : "\u25b6"} ${projects.length}` : ""}
                    </span>
                  </button>
                  {expandedAccounts.has(account) && (
                    <div className="ml-2 mb-1 space-y-0.5">
                      {projects.map((tag) => (
                        <div
                          key={tag.id}
                          className="flex items-center group"
                        >
                          <button
                            onClick={() => onSelectProject(account, tag.project_name)}
                            className="flex-1 text-left py-1.5 px-2.5 rounded-md text-[11px] text-walnut hover:bg-terracotta-soft hover:text-terracotta cursor-pointer transition-colors"
                          >
                            {tag.project_name}
                          </button>
                          {isAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteProject(tag.id);
                              }}
                              disabled={deletingId === tag.id}
                              className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-[9px] text-stone hover:text-red-500 cursor-pointer transition-all"
                              title="Remove project"
                            >
                              {deletingId === tag.id ? "..." : "\u00d7"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
