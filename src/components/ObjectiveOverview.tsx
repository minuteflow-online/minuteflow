"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/database";

type Stats = Record<string, { total: number; done: number }>;

interface ObjectiveOverviewProps {
  projects: Project[];
  onSelect: (project: Project) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/**
 * Objective landing dashboard shown in the right panel before a project is
 * selected. Stage 1: the Objectives overview card + a progress graph, both fed
 * by /api/projects/subtask-stats (per-project subtask totals). The Message
 * Board and Docs cards land in later stages.
 */
export default function ObjectiveOverview({ projects, onSelect }: ObjectiveOverviewProps) {
  const [stats, setStats] = useState<Stats>({});

  // Root objectives (no parent) and the parent→children map, from the list the
  // page already loaded.
  const { roots, childrenByParent } = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) {
      const key = p.parent_project_id ?? "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return { roots: map.get("__root__") ?? [], childrenByParent: map };
  }, [projects]);

  useEffect(() => {
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) { setStats({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/subtask-stats?projectIds=${ids.join(",")}`, { cache: "no-store" });
        const d = await res.json();
        if (!cancelled) setStats(d.stats ?? {});
      } catch {
        if (!cancelled) setStats({});
      }
    })();
    return () => { cancelled = true; };
  }, [projects]);

  // Aggregate a parent's own + all descendants' subtask stats, plus a
  // descendant objective count.
  const rollup = useMemo(() => {
    const collectDescendants = (id: string, acc: string[]) => {
      for (const child of childrenByParent.get(id) ?? []) {
        acc.push(child.id);
        collectDescendants(child.id, acc);
      }
      return acc;
    };
    const byRoot = new Map<string, { total: number; done: number; subObjectives: number }>();
    for (const root of roots) {
      const descendants = collectDescendants(root.id, []);
      const ids = [root.id, ...descendants];
      let total = 0, done = 0;
      for (const id of ids) {
        total += stats[id]?.total ?? 0;
        done += stats[id]?.done ?? 0;
      }
      byRoot.set(root.id, { total, done, subObjectives: descendants.length });
    }
    return byRoot;
  }, [roots, childrenByParent, stats]);

  const statusCls = (active: boolean) =>
    active ? "bg-sage-soft text-sage border-sage/20" : "bg-stone/10 text-stone border-stone/20";

  if (roots.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-8 shadow-sm text-center">
        <p className="text-sm font-medium text-espresso">No objectives yet</p>
        <p className="mt-1 text-xs text-stone">Create one with &ldquo;New Objective&rdquo; to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Card 2 — Objectives overview */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3 lg:col-span-1">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Objectives</h3>
        <div className="space-y-2">
          {roots.map((p) => {
            const r = rollup.get(p.id) ?? { total: 0, done: 0, subObjectives: 0 };
            const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="w-full text-left flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-espresso leading-tight truncate">{p.name}</span>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${statusCls(p.is_active)}`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-parchment">
                  <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-stone/80">
                  <span>{r.subObjectives} sub-objective{r.subObjectives === 1 ? "" : "s"} · {r.total} subtask{r.total === 1 ? "" : "s"} · {pct}%</span>
                  {p.target_date && <span className="text-terracotta font-semibold shrink-0">Target: {formatDate(p.target_date)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Card 4 — Progress graph */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3 lg:col-span-1">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Progress</h3>
        <div className="space-y-2.5">
          {roots.map((p) => {
            const r = rollup.get(p.id) ?? { total: 0, done: 0, subObjectives: 0 };
            const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
            return (
              <div key={p.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-espresso truncate">{p.name}</span>
                  <span className="text-stone shrink-0">{r.done}/{r.total}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-parchment">
                  <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
