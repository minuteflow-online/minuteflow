"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  type RawTask,
  getDateInTimezone,
  addDaysToDateStr,
  formatDayLabel,
  orgDateOf,
  formatTimeRange,
  normalizeAssignedRows,
  categoryBlockClasses,
  reanchorToDate,
  orgWallClockToUtc,
} from "@/lib/taskSchedule";

type TeamMemberOption = { id: string; full_name: string; username: string };

interface TeamWorkloadViewProps {
  currentUserId: string;
  teamMembers: TeamMemberOption[];
  orgTimezone?: string;
}

export default function TeamWorkloadView({ currentUserId, teamMembers, orgTimezone = "UTC" }: TeamWorkloadViewProps) {
  const todayStr = getDateInTimezone(orgTimezone);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [schedules, setSchedules] = useState<Record<string, RawTask[]>>({});
  const [loading, setLoading] = useState(false);

  // Show the whole team, not just staff (va/admin). Fetch every active member;
  // fall back to the passed-in list if the request fails.
  const [allMembers, setAllMembers] = useState<TeamMemberOption[]>(teamMembers);
  // Which members' columns are shown. Empty until the member list loads, then
  // seeded to "all" once (a ref guards against clobbering the user's choice on
  // later refetches).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team-members?all=true", { cache: "no-store" });
        const d = await res.json();
        if (!cancelled && Array.isArray(d.members)) {
          setAllMembers(d.members.map((m: TeamMemberOption) => ({ id: m.id, full_name: m.full_name, username: m.username })));
        }
      } catch {
        // keep the passed-in list
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!seededRef.current && allMembers.length > 0) {
      setSelectedIds(new Set(allMembers.map((m) => m.id)));
      seededRef.current = true;
    }
  }, [allMembers]);

  const visibleMembers = allMembers.filter((m) => selectedIds.has(m.id));

  const [showForm, setShowForm] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [formTaskName, setFormTaskName] = useState("");
  const [formAccount, setFormAccount] = useState("");
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("10:00");
  const [savingBlock, setSavingBlock] = useState(false);

  const fetchSchedules = useCallback(async () => {
    if (allMembers.length === 0) return;
    setLoading(true);
    try {
      const entries = await Promise.all(
        allMembers.map(async (m) => {
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
      setSchedules(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [allMembers, currentUserId]);

  const toggleMember = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllMembers = () => setSelectedIds(new Set(allMembers.map((m) => m.id)));
  const clearMembers = () => setSelectedIds(new Set());

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const goToPrevDay = () => setSelectedDate((d) => addDaysToDateStr(d, -1));
  const goToNextDay = () => setSelectedDate((d) => addDaysToDateStr(d, 1));

  const openEditBlock = (task: RawTask) => {
    if (!task.start_time || !task.end_time) return;
    setEditingBlockId(task.id);
    setFormTaskName(task.task_name);
    setFormAccount(task.account || "");
    // Reanchored before render, so these are naive org wall-clock strings —
    // slice rather than re-parsing through Date, which would re-interpret them
    // in the viewer's own zone.
    setFormStart(task.start_time.slice(11, 16));
    setFormEnd(task.end_time.slice(11, 16));
    setShowForm(true);
  };

  const saveBlock = async () => {
    if (!editingBlockId || formEnd <= formStart) return;
    setSavingBlock(true);
    // Org wall clock in, same as the Calendar's own form — parsing these
    // browser-locally stored a Manila admin's 9am as 9am Manila (= 9pm
    // Eastern the day before).
    const startIso = orgWallClockToUtc(selectedDate, formStart);
    const endIso = orgWallClockToUtc(selectedDate, formEnd);
    try {
      await fetch(`/api/assigned-tasks/${editingBlockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: startIso, end_time: endIso }),
      });
      await fetchSchedules();
    } finally {
      setSavingBlock(false);
      setShowForm(false);
    }
  };

  // "Remove from Calendar" used to live here too — removed with its button
  // rather than left as dead code, matching the day/week calendar.
  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={goToPrevDay}
          className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
        >
          &larr;
        </button>
        <h2 className="text-sm font-bold text-espresso">
          {selectedDate === todayStr ? "Today — " : ""}
          {formatDayLabel(selectedDate)}
        </h2>
        <button
          type="button"
          onClick={goToNextDay}
          className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
        >
          &rarr;
        </button>
      </div>

      {allMembers.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-sand pb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-walnut mr-1">Show</span>
          {allMembers.map((m) => {
            const on = selectedIds.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                className={`text-[11px] font-semibold px-2 py-[3px] rounded-full border transition-colors ${
                  on
                    ? "bg-sage-soft text-sage border-sage/20"
                    : "bg-stone/10 text-stone border-stone/20 hover:bg-stone/20"
                }`}
              >
                {m.full_name || m.username}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-sand" />
          <button type="button" onClick={selectAllMembers} className="text-[10px] font-semibold text-bark hover:text-espresso px-1">All</button>
          <button type="button" onClick={clearMembers} className="text-[10px] font-semibold text-bark hover:text-espresso px-1">None</button>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-xs text-stone">Loading team schedules…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {visibleMembers.length === 0 && (
            <p className="py-8 text-center text-xs text-stone w-full">No team members selected.</p>
          )}
          {visibleMembers.map((m) => {
            const rawDayTasks = (schedules[m.id] ?? [])
              .filter((t) => t.start_time && t.end_time && orgDateOf(t.start_time) === selectedDate)
              .sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1));
            // Totals come off the real instants, so a block running past
            // midnight still measures its true length.
            const totalMinutes = rawDayTasks.reduce(
              (sum, t) => sum + (new Date(t.end_time!).getTime() - new Date(t.start_time!).getTime()) / 60000,
              0
            );
            // Display only: reanchoring yields the org wall clock, so this card
            // reads the same hours for a Manila admin and an Eastern one.
            const dayTasks = rawDayTasks.map((t) => reanchorToDate(t, selectedDate));
            const hrs = Math.floor(totalMinutes / 60);
            const mins = Math.round(totalMinutes % 60);
            const loadClass =
              totalMinutes === 0
                ? "bg-stone/10 text-stone border-stone/20"
                : totalMinutes >= 420
                ? "bg-red-50 text-red-500 border-red-200"
                : "bg-sage-soft text-sage border-sage/20";
            return (
              <div key={m.id} className="w-56 shrink-0 rounded-lg border border-sand bg-cream/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-bold text-espresso">{m.full_name || m.username}</p>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${loadClass}`}>
                    {hrs}h{mins > 0 ? ` ${mins}m` : ""}
                  </span>
                </div>
                {dayTasks.length === 0 ? (
                  <p className="text-[11px] text-stone">No hours scheduled.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dayTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openEditBlock(t)}
                        className={`w-full overflow-hidden rounded-md border px-2 py-1.5 text-left hover:opacity-90 cursor-pointer ${categoryBlockClasses(t.category)}`}
                      >
                        <p className="truncate text-[11px] font-semibold">
                          {t.task_name}
                        </p>
                        <p className="truncate text-[10px] opacity-80">{formatTimeRange(t)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-sm mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Reschedule</h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Task Name</p>
                <input
                  value={formTaskName}
                  disabled
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-parchment/40 text-stone"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Account</p>
                <input
                  value={formAccount || "—"}
                  disabled
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-parchment/40 text-stone"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Start</p>
                  <input
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">End</p>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                </div>
              </div>
              {formEnd <= formStart && (
                <p className="text-[10px] text-terracotta">End time must be after start time.</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 rounded-lg bg-parchment text-walnut border border-sand text-[12px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={saveBlock}
                  disabled={formEnd <= formStart || savingBlock}
                  className="flex-1 py-2 rounded-lg bg-sage text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-sage/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingBlock ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
