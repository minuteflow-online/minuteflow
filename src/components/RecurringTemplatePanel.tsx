"use client";

import { useMemo, useState } from "react";
import TaskEditor, { type TeamMemberOption } from "@/components/TaskEditor";
import { orgWallClockToUtc, RECURRENCE_OPTIONS, type RecurrenceType } from "@/lib/taskSchedule";
import { WEEKDAY_SHORT } from "@/lib/budget";
import WorkDaysPicker from "@/components/WorkDaysPicker";
import type { RecurringTaskTemplate } from "@/types/database";

const RECURRENCE_VALUES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "every_2_months",
  "every_3_months",
] as const;

function assignedToIds(template: RecurringTaskTemplate): string[] {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

/**
 * The slide-over for creating or editing a recurring template.
 *
 * Lifted out of RecurringTemplatesManager so an Operation or Objective can open
 * a template from the Recurring card it already shows. Templates were listed
 * there but not openable, and the alternative — a second copy of this panel —
 * is exactly how the old hand-written template form drifted behind TaskEditor
 * in the first place.
 *
 * Mount it keyed on the template id: the Repeat fields seed from props once, so
 * a reused instance would show the previous template's schedule.
 */
export default function RecurringTemplatePanel({
  template,
  currentUserId,
  teamMembers,
  isAdminOrManager,
  onSaved,
  onCancel,
}: {
  template: RecurringTaskTemplate | null;
  currentUserId: string;
  teamMembers: TeamMemberOption[];
  isAdminOrManager: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(() =>
    template && RECURRENCE_VALUES.includes(template.recurrence_type as (typeof RECURRENCE_VALUES)[number])
      ? (template.recurrence_type as RecurrenceType)
      : "daily"
  );
  const [isActive, setIsActive] = useState(() => template?.is_active ?? true);
  const [repeatUntil, setRepeatUntil] = useState(() => template?.repeat_until?.slice(0, 10) ?? "");
  // Weekday indices (0=Sun..6=Sat, WorkDaysPicker's own convention), only
  // meaningful when recurrenceType is "weekly" — see recurrence_days on
  // RecurringTaskTemplate. Lets one template land on several days a week
  // instead of needing a separate template per weekday, which the templates
  // API's duplicate guard (same Task Name/Detail/Account/assignee) rejects.
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>(() =>
    (template?.recurrence_days ?? [])
      .map((name) => WEEKDAY_SHORT.findIndex((w) => w.toLowerCase() === String(name).trim().slice(0, 3).toLowerCase()))
      .filter((i) => i >= 0)
  );
  // Mode picker only for a brand-new template — an existing one's mode is
  // fixed by which table its occurrences already live in (assigned_tasks vs.
  // fixed_pay_tasks), same as TaskEditor's own create-only toggle elsewhere
  // (assignment/page.tsx's New Task panel). Editing one seeds from its own
  // pay_type so an existing Output Based template still opens correctly.
  // 'fixed', not 'output_based' — recurring_task_templates.pay_type has a DB
  // check constraint allowing only 'fixed'/'hourly' (see isOutputBased in
  // recurringOccurrences.ts).
  const [mode, setMode] = useState<"time_based" | "output_based">(() =>
    template?.pay_type === "fixed" ? "output_based" : "time_based"
  );

  // TaskEditor reads a task-shaped row, and a template is close enough to hand
  // it one directly — the column names line up on both sides. One exception:
  // a template's start_time/end_time are bare clock times ("09:00", no date —
  // each occurrence supplies its own), while TaskEditor always treats
  // initialTask.start_time/end_time as a full instant and runs them through
  // timeOfDay()/orgDateOf() unconditionally (src/lib/taskSchedule.ts). Handing
  // a bare "09:00" to `new Date("09:00")` produces an Invalid Date, and
  // formatToParts() on that throws — crashing the editor the instant you open
  // an existing template with a schedule set. Fixed by re-anchoring the clock
  // time onto a real date with the same conversion TaskEditor itself uses when
  // *saving* a task's hours (orgWallClockToUtc) — timeOfDay() then correctly
  // reads the same "HH:MM" back out on the other end. The anchor date doesn't
  // matter beyond being valid; only the time-of-day round-trips.
  const initialTask = useMemo(() => {
    if (!template) return null;
    const row = template as unknown as Record<string, unknown>;
    const anchorDate = template.start_date || new Date().toISOString().slice(0, 10);
    const toInstant = (clockTime: string | null | undefined) =>
      clockTime ? orgWallClockToUtc(anchorDate, clockTime) : clockTime;
    return {
      ...row,
      task_name: template.title ?? template.task_name ?? "",
      task_detail: template.task_detail ?? template.description ?? "",
      assigned_task_assignees: assignedToIds(template).map((va_id) => ({ va_id })),
      start_time: toInstant(template.start_time),
      end_time: toInstant(template.end_time),
    } as Record<string, unknown>;
  }, [template]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40">
      <div className="absolute inset-y-0 right-0 flex w-full justify-end">
        <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-sand px-6 py-4">
            <div>
              <h2 className="text-sm font-bold text-espresso">
                {template ? "Edit recurring template" : "Create recurring template"}
              </h2>
              <p className="text-[11px] text-stone">The task form, plus how often it repeats.</p>
            </div>
            <button onClick={onCancel} className="text-stone hover:text-espresso cursor-pointer">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!template && (
              <div className="mb-4 flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                <button
                  type="button"
                  onClick={() => setMode("time_based")}
                  className={`flex-1 px-3 py-1.5 transition-colors ${mode === "time_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                >
                  Time-based Task
                </button>
                <button
                  type="button"
                  onClick={() => setMode("output_based")}
                  className={`flex-1 px-3 py-1.5 transition-colors ${mode === "output_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                >
                  Output Based Task
                </button>
              </div>
            )}
            {/* The same TaskEditor every other surface uses. This panel used to
                be a hand-written copy of it, which is why it kept falling
                behind — Review Required, Link, calendar hours, the duration
                field and the assignee picker all landed there and never here.
                One form now, with Repeat/Active added on top. */}
            <TaskEditor
              key={mode}
              mode={mode}
              templateMode
              editingTemplateId={template?.id ?? null}
              initialTask={initialTask}
              currentUserId={currentUserId}
              isAdminOrManager={isAdminOrManager}
              teamMembers={teamMembers}
              templateExtra={{
                recurrence_type: recurrenceType,
                recurrence_days: recurrenceType === "weekly" ? recurrenceDays.map((i) => WEEKDAY_SHORT[i]) : [],
                is_active: isActive,
                repeat_until: repeatUntil || null,
              }}
              onCancel={onCancel}
              onSaved={onSaved}
              recurrenceControl={
                <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-amber">
                      Repeat
                    </label>
                    <select
                      value={recurrenceType}
                      onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    >
                      {RECURRENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-stone">
                      {RECURRENCE_OPTIONS.find((option) => option.value === recurrenceType)?.helper}
                    </p>
                  </div>
                  {recurrenceType === "weekly" && (
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-walnut">Days (optional)</label>
                      <WorkDaysPicker value={recurrenceDays} onChange={setRecurrenceDays} />
                      <p className="mt-1 text-[11px] text-stone">
                        {recurrenceDays.length > 0
                          ? "Lands on these days every week."
                          : "Leave empty to repeat weekly on the Start Date's own weekday."}
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-walnut">Repeat until (optional)</label>
                    <input
                      type="date"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    />
                    <p className="mt-1 text-[11px] text-stone">
                      {repeatUntil ? `Stops after ${repeatUntil}.` : "Leave blank to repeat indefinitely."}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                    />
                    Active
                  </label>
                </div>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
