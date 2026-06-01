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
  onAutoHoldAction: (mapping: QuickActionMapping) => void;
  isAdmin: boolean;
}

export default function ProjectSidebar({
  onSelectProject,
  onQuickAction,
  onAutoHoldAction,
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
        {/* Quick Message Actions */}
        <div className="px-4 py-3 border-b border-parchment">
          <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
            Quick Actions
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() =>
                onAutoHoldAction({
                  category: "Communication",
                  task_name: "Message for Guidance/Instructions",
                  account: "Virtual Concierge",
                  project: "Supervision",
                  client_name: "Toni Colina",
                })
              }
              className="w-full py-3 px-4 rounded-xl bg-slate-blue text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#4a5568] text-left leading-tight"
            >
              💬 Message for Guidance/Instructions
            </button>
            <button
              onClick={() =>
                onAutoHoldAction({
                  category: "Communication",
                  task_name: "General Message",
                  account: "Virtual Concierge",
                  project: "Supervision",
                  client_name: "Toni Colina",
                })
              }
              className="w-full py-3 px-4 rounded-xl bg-terracotta-soft text-terracotta text-[12px] font-semibold cursor-pointer transition-all hover:bg-terracotta hover:text-white text-left leading-tight border border-terracotta/30"
            >
              📨 General Message
            </button>
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
