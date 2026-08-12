"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { type RawTask, normalizeAssignedRows, statusBadgeClasses, statusLabel } from "@/lib/taskSchedule";
import type { Project } from "@/types/database";

type TeamMemberOption = { id: string; full_name: string; username: string };

interface ObjectiveProgressViewProps {
  currentUserId: string;
  teamMembers: TeamMemberOption[];
}

export default function ObjectiveProgressView({ currentUserId, teamMembers }: ObjectiveProgressViewProps) {
  const [objectives, setObjectives] = useState<Project[]>([]);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState("");
  const [teamTasks, setTeamTasks] = useState<Record<string, RawTask[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setObjectives(d.projects ?? []))
      .catch(() => {});
  }, []);

  // The selected Objective plus every nested sub-project under it — "progress of
  // the goal" means the whole tree, not just tasks on the exact node picked.
  const descendantIds = useMemo(() => {
    if (!selectedObjectiveId) return new Set<string>();
    const childrenByParent = new Map<string, string[]>();
    for (const p of objectives) {
      const key = p.parent_project_id ?? "__root__";
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(p.id);
    }
    const result = new Set<string>();
    const stack = [selectedObjectiveId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
    }
    return result;
  }, [selectedObjectiveId, objectives]);

  const fetchTeamTasks = useCallback(async () => {
    if (teamMembers.length === 0) return;
    setLoading(true);
    try {
      const entries = await Promise.all(
        teamMembers.map(async (m) => {
          const url =
            m.id === currentUserId
              ? "/api/assigned-tasks?selfOnly=true&view=active"
              : `/api/assigned-tasks?viewAsVa=${m.id}&view=active`;
          try {
            const res = await fetch(url);
            const data = await res.json();
            return [m.id, normalizeAssignedRows(data.tasks ?? [], m.id)] as const;
          } catch {
            return [m.id, []] as const;
          }
        })
      );
      setTeamTasks(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [teamMembers, currentUserId]);

  useEffect(() => {
    void fetchTeamTasks();
  }, [fetchTeamTasks]);

  const cards = useMemo(() => {
    if (!selectedObjectiveId) return [];
    return teamMembers
      .map((m) => {
        const tasks = (teamTasks[m.id] ?? []).filter((t) => t.projectId && descendantIds.has(t.projectId));
        const counts: Record<string, number> = {};
        for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
        return { member: m, tasks, counts };
      })
      .filter((c) => c.tasks.length > 0);
  }, [teamMembers, teamTasks, descendantIds, selectedObjectiveId]);

  const totalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      for (const [status, n] of Object.entries(c.counts)) {
        counts[status] = (counts[status] ?? 0) + n;
      }
    }
    return counts;
  }, [cards]);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Objective</label>
        <select
          value={selectedObjectiveId}
          onChange={(e) => setSelectedObjectiveId(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta bg-white"
        >
          <option value="">Select an Objective...</option>
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {!selectedObjectiveId ? (
        <p className="text-[12px] text-stone">Pick an Objective above to see the team's progress on it.</p>
      ) : loading ? (
        <div className="py-8 text-center text-xs text-stone">Loading…</div>
      ) : (
        <>
          {Object.keys(totalCounts).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(totalCounts).map(([status, count]) => (
                <span key={status} className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${statusBadgeClasses(status)}`}>
                  {count} {statusLabel(status)}
                </span>
              ))}
            </div>
          )}

          {cards.length === 0 ? (
            <p className="text-[12px] text-stone">No tasks are linked to this Objective (or its sub-projects) yet.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {cards.map(({ member, tasks, counts }) => (
                <div key={member.id} className="w-56 shrink-0 rounded-lg border border-sand bg-cream/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-bold text-espresso">{member.full_name || member.username}</p>
                    <span className="shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-stone/10 text-stone border-stone/20">
                      {tasks.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(counts).map(([status, count]) => (
                      <span key={status} className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${statusBadgeClasses(status)}`}>
                        {count} {statusLabel(status)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
