"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A team member's assigned accounts, their per-account hour budgets, and the
 * assignments sitting under each account.
 *
 * One component serves both surfaces: the admin panel passes editable so
 * accounts can be linked, budgets set, and accounts unlinked; the VA's own
 * portal renders the same data read-only.
 *
 * Accounts arrive from the API in two flavours — assigned directly by an admin,
 * or inherited because the VA is on a project belonging to that account. Only a
 * direct assignment can hold a budget, so an inherited row offers "Assign" to
 * turn it into one.
 */

type AssignmentRow = {
  assignmentId: number | null;
  accountId: number;
  accountName: string;
  inherited: boolean;
  viaProjects: string[];
  weekly_hours_budget: number | null;
  monthly_hours_budget: number | null;
  /* Free text, typed in by an admin — deliberately not pulled from the task
     list, so it says whatever the account actually needs it to say. */
  assignments: string | null;
};

type AccountOption = { id: number; name: string };

export default function VaAccountAssignments({
  vaId,
  editable = false,
}: {
  vaId: string;
  editable?: boolean;
}) {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [allAccounts, setAllAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [linkId, setLinkId] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingBudgetId, setEditingBudgetId] = useState<number | null>(null);
  const [editWeekly, setEditWeekly] = useState("");
  const [editMonthly, setEditMonthly] = useState("");
  const [editingAssignId, setEditingAssignId] = useState<number | null>(null);
  const [editAssignments, setEditAssignments] = useState("");

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch(`/api/va-account-assignments?va_id=${vaId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.assignments ?? []);
      setAllAccounts(data.allAccounts ?? []);
    } catch {
      // Leave whatever is on screen rather than blanking the block.
    } finally {
      setLoading(false);
    }
  }, [vaId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const linkAccount = async (accountId: number) => {
    setSaving(true);
    await fetch("/api/va-account-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ va_id: vaId, account_id: accountId }),
    });
    setLinkId("");
    setSaving(false);
    fetchRows();
  };

  const unlinkAccount = async (assignmentId: number) => {
    setSaving(true);
    await fetch(`/api/va-account-assignments?id=${assignmentId}`, { method: "DELETE" });
    setSaving(false);
    fetchRows();
  };

  const saveBudget = async (assignmentId: number) => {
    const parse = (v: string) => {
      const t = v.trim();
      if (t === "") return null;
      const n = parseFloat(t);
      return isNaN(n) || n < 0 ? undefined : n;
    };
    const weekly = parse(editWeekly);
    const monthly = parse(editMonthly);
    if (weekly === undefined || monthly === undefined) return;

    setSaving(true);
    await fetch("/api/va-account-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: assignmentId,
        weekly_hours_budget: weekly,
        monthly_hours_budget: monthly,
      }),
    });
    setEditingBudgetId(null);
    setSaving(false);
    fetchRows();
  };

  const saveAssignments = async (assignmentId: number) => {
    setSaving(true);
    await fetch("/api/va-account-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assignmentId, assignments: editAssignments }),
    });
    setEditingAssignId(null);
    setSaving(false);
    fetchRows();
  };

  const linkable = allAccounts.filter((a) => !rows.some((r) => r.accountId === a.id && !r.inherited));

  if (loading) {
    return <div className="h-24 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Assigned Accounts</h3>
        {editable && linkable.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            >
              <option value="">Link account...</option>
              {linkable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => linkId && linkAccount(Number(linkId))}
              disabled={!linkId || saving}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              Link
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-bark">
          {editable ? "No accounts assigned yet." : "No accounts assigned to you yet."}
        </p>
      ) : (
        rows.map((row) => {
          const isOpen = expanded.has(row.accountId);
          const hasBudget = row.weekly_hours_budget != null || row.monthly_hours_budget != null;
          return (
            <div key={row.accountId} className="rounded-lg border border-sand bg-white">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.accountId)) next.delete(row.accountId);
                      else next.add(row.accountId);
                      return next;
                    })
                  }
                  className="flex flex-1 items-center gap-2 text-left group"
                >
                  <span className="w-3 shrink-0 text-[10px] text-bark group-hover:text-espresso transition-colors">
                    {row.inherited ? "" : isOpen ? "▾" : "▸"}
                  </span>
                  <span className="text-[13px] font-semibold text-espresso">{row.accountName}</span>
                  {row.inherited && (
                    <span
                      title={
                        row.viaProjects.length > 0
                          ? `From project: ${row.viaProjects.join(", ")}`
                          : "From a project assignment"
                      }
                      className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-slate-blue-soft text-slate-blue border border-slate-blue/20"
                    >
                      via project
                    </span>
                  )}
                  {row.assignments && (
                    <span className="text-[11px] text-stone/80 truncate max-w-[220px]">
                      {row.assignments.split(String.fromCharCode(10))[0]}
                    </span>
                  )}
                </button>

                {/* Budget — only a direct assignment can carry one. */}
                {editable && !row.inherited && editingBudgetId === row.assignmentId ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={editWeekly}
                      onChange={(e) => setEditWeekly(e.target.value)}
                      placeholder="wk"
                      autoFocus
                      className="w-14 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                    />
                    <span className="text-[10px] text-bark">/</span>
                    <input
                      value={editMonthly}
                      onChange={(e) => setEditMonthly(e.target.value)}
                      placeholder="mo"
                      className="w-14 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                    />
                    <button
                      onClick={() => row.assignmentId && saveBudget(row.assignmentId)}
                      className="text-sage text-sm font-bold"
                    >
                      OK
                    </button>
                    <button onClick={() => setEditingBudgetId(null)} className="text-bark hover:text-terracotta text-sm">
                      &times;
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (!editable || row.inherited || !row.assignmentId) return;
                      setEditingBudgetId(row.assignmentId);
                      setEditWeekly(row.weekly_hours_budget != null ? String(row.weekly_hours_budget) : "");
                      setEditMonthly(row.monthly_hours_budget != null ? String(row.monthly_hours_budget) : "");
                    }}
                    disabled={!editable || row.inherited}
                    title={editable && !row.inherited ? "Set weekly / monthly hour budget" : undefined}
                    className={`text-[11px] text-espresso whitespace-nowrap transition-colors ${
                      editable && !row.inherited ? "cursor-pointer hover:text-terracotta" : "cursor-default"
                    }`}
                  >
                    {hasBudget ? (
                      <>
                        {row.weekly_hours_budget != null ? `${Number(row.weekly_hours_budget)}h` : "—"}
                        <span className="text-bark/60"> wk</span>
                        <span className="text-bark/40"> · </span>
                        {row.monthly_hours_budget != null ? `${Number(row.monthly_hours_budget)}h` : "—"}
                        <span className="text-bark/60"> mo</span>
                      </>
                    ) : editable && !row.inherited ? (
                      <span className="text-bark/50 italic">Set budget</span>
                    ) : (
                      <span className="text-bark/50 italic">No budget</span>
                    )}
                  </button>
                )}

                {editable && (
                  row.inherited ? (
                    <button
                      onClick={() => linkAccount(row.accountId)}
                      disabled={saving}
                      title="Assign directly so it can carry a budget"
                      className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
                    >
                      Assign
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => row.assignmentId && unlinkAccount(row.assignmentId)}
                        disabled={saving}
                        title="Unlink this account"
                        className="text-bark hover:text-terracotta text-sm px-1 disabled:opacity-50"
                      >
                        &times;
                      </button>
                    </div>
                  )
                )}
              </div>

              {isOpen && !row.inherited && (
                <div className="border-t border-parchment px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Assignments</p>
                  {editable && editingAssignId === row.assignmentId ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editAssignments}
                        onChange={(e) => setEditAssignments(e.target.value)}
                        rows={4}
                        autoFocus
                        placeholder="What they handle on this account — one per line"
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => row.assignmentId && saveAssignments(row.assignmentId)}
                          disabled={saving}
                          className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingAssignId(null)}
                          className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (!editable || !row.assignmentId) return;
                        setEditingAssignId(row.assignmentId);
                        setEditAssignments(row.assignments ?? "");
                      }}
                      disabled={!editable}
                      className={`w-full text-left text-[12px] whitespace-pre-wrap transition-colors ${
                        editable ? "cursor-pointer hover:text-terracotta" : "cursor-default"
                      } ${row.assignments ? "text-espresso" : "text-bark/50 italic"}`}
                    >
                      {row.assignments || (editable ? "Add assignments" : "None listed")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
