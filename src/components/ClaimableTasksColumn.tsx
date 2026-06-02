"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

interface ClaimableTask {
  id: number;
  task_library_id: number;
  project_tag_id: number;
  billing_type: string | null;
  task_rate: number | null;
  instructions: string | null;
  quantity: number;
  claimed_slots: number;
  remaining_slots: number;
  already_claimed_by_me: boolean;
  task_library: { id: number; task_name: string; billing_type: string; default_rate: number | null } | null;
  project_tags: { id: number; account: string; project_name: string } | null;
}

/* ── Linkify helper ────────────────────────────────────── */

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800 break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function ClaimableTasksColumn({ onClaimed }: { onClaimed?: () => void }) {
  const [tasks, setTasks] = useState<ClaimableTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // quantity_claimed picker: task.id → chosen qty
  const [claimQty, setClaimQty] = useState<Record<number, number>>({});

  /* ── Fetch claimable tasks ── */
  const fetchClaimable = useCallback(async () => {
    try {
      const res = await fetch("/api/claimable-tasks");
      const data = await res.json();
      setTasks(data.claimable ?? []);
    } catch {
      console.error("Failed to fetch claimable tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaimable();
  }, [fetchClaimable]);

  /* ── Claim a task ── */
  const handleClaim = async (ptaId: number, remaining: number) => {
    const qty = claimQty[ptaId] ?? 1;
    if (qty < 1 || qty > remaining) return;

    setClaiming(ptaId);
    try {
      const res = await fetch("/api/claimable-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_task_assignment_id: ptaId, quantity_claimed: qty }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to claim task");
        return;
      }
      // Re-fetch so remaining count updates (task stays if slots remain)
      setClaimQty((prev) => { const c = { ...prev }; delete c[ptaId]; return c; });
      setExpandedId(null);
      fetchClaimable();
      // Notify parent to refresh assignments
      onClaimed?.();
    } catch {
      console.error("Failed to claim task");
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5 sticky top-0 bg-white pb-1 z-10">
        <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        Available Tasks
        <span className="text-stone font-normal normal-case">({tasks.length})</span>
      </h3>

      {loading ? (
        <p className="text-stone text-[11px] text-center py-3">Loading...</p>
      ) : tasks.length === 0 ? (
        <p className="text-stone text-[11px] text-center py-3 italic">No tasks available to claim right now.</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((t) => {
            const taskName = t.task_library?.task_name ?? "Unknown Task";
            const account = t.project_tags?.account ?? "";
            const project = t.project_tags?.project_name ?? "";
            const rate = t.task_rate ?? t.task_library?.default_rate ?? null;
            const isClaiming = claiming === t.id;
            const isExpanded = expandedId === t.id;
            const hasInstructions = !!t.instructions;
            const remaining = t.remaining_slots;
            const isMultiSlot = t.quantity > 1;
            const selectedQty = claimQty[t.id] ?? 1;
            const alreadyClaimed = t.already_claimed_by_me;

            return (
              <div
                key={t.id}
                className="rounded-lg border border-sand overflow-hidden"
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className={`px-2.5 py-2 cursor-pointer transition-colors ${isExpanded ? "bg-parchment/30" : "bg-parchment/20 hover:bg-parchment/30"}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-espresso truncate">{taskName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {hasInstructions && (
                        <span className="px-1 py-0.5 rounded text-[8px] font-semibold bg-indigo-100 text-indigo-600">
                          📋
                        </span>
                      )}
                      {isMultiSlot && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-100 text-amber-700">
                          {remaining} of {t.quantity} left
                        </span>
                      )}
                      {rate != null && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                          ${Number(rate).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {account}
                    {project ? ` / ${project}` : ""}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-2.5 py-2.5 border-t border-sand bg-parchment/10 space-y-2" onClick={(e) => e.stopPropagation()}>
                    {/* Instructions */}
                    {t.instructions && (
                      <div className="bg-indigo-50 border-l-3 border-l-indigo-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[10px] font-bold text-stone uppercase mb-1">Instructions</div>
                        <div className="text-xs text-espresso whitespace-pre-wrap">
                          {linkify(t.instructions)}
                        </div>
                      </div>
                    )}

                    {!t.instructions && (
                      <div className="text-stone text-[11px] italic">
                        No instructions provided. You can claim and get started.
                      </div>
                    )}

                    {/* Quantity picker — only shown when more than 1 slot is available */}
                    {isMultiSlot && (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold text-stone whitespace-nowrap">
                          How many do you want to take?
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={remaining}
                          value={selectedQty}
                          onChange={(e) => {
                            const val = Math.min(remaining, Math.max(1, parseInt(e.target.value) || 1));
                            setClaimQty((prev) => ({ ...prev, [t.id]: val }));
                          }}
                          className="w-16 rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none text-center"
                        />
                        <span className="text-[10px] text-stone">of {remaining} available</span>
                      </div>
                    )}

                    {alreadyClaimed ? (
                      <div className="w-full px-3 py-2 rounded-lg bg-stone/10 text-stone text-[11px] font-semibold text-center">
                        ✓ Already claimed by you
                      </div>
                    ) : (
                      <button
                        onClick={() => handleClaim(t.id, remaining)}
                        disabled={isClaiming}
                        className="w-full px-3 py-2 rounded-lg bg-terracotta text-white text-[11px] font-semibold hover:bg-[#c4573a] disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {isClaiming
                          ? "Claiming..."
                          : isMultiSlot && selectedQty > 1
                          ? `Claim ${selectedQty} Slots`
                          : "Claim This Task"}
                      </button>
                    )}
                  </div>
                )}

                {/* Collapsed: expand to pick qty if multi-slot, else claim directly */}
                {!isExpanded && (
                  <div className="px-2.5 pb-2 bg-parchment/20">
                    {alreadyClaimed ? (
                      <div className="w-full px-3 py-1.5 rounded-lg bg-stone/10 text-stone text-[11px] font-semibold text-center">
                        ✓ Already claimed by you
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isMultiSlot) {
                            setExpandedId(t.id);
                          } else {
                            handleClaim(t.id, remaining);
                          }
                        }}
                        disabled={isClaiming}
                        className="w-full px-3 py-1.5 rounded-lg bg-terracotta text-white text-[11px] font-semibold hover:bg-[#c4573a] disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {isClaiming ? "Claiming..." : isMultiSlot ? "See Details to Claim" : "Claim This Task"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
