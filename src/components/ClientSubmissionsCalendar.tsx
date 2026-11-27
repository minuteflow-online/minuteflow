"use client";

import { useMemo, useState } from "react";
import { timelinessOf, type Timeliness } from "@/lib/onTime";
import RevisionBadge from "@/components/RevisionBadge";
import type { ClientFeedItem } from "@/lib/clientSubmissionsTypes";

type CalendarScale = "month" | "week" | "day" | "custom";

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseDayKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function shiftDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

const MAX_CUSTOM_DAYS = 92;
const CHIP_LIMIT: Record<CalendarScale, number> = { month: 3, week: 8, day: 60, custom: 4 };
const CELL_HEIGHT: Record<CalendarScale, string> = {
  month: "min-h-[76px]",
  week: "min-h-[170px]",
  day: "min-h-[240px]",
  custom: "min-h-[110px]",
};

const TIMELINESS_CHIP: Record<Timeliness, string> = {
  on_time: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late_same_day: "border-amber-200 bg-amber-50 text-amber-700",
  late_other_day: "border-plum/30 bg-plum-soft text-plum",
  no_deadline: "border-sand bg-parchment/60 text-walnut",
};
const TIMELINESS_LABEL: Record<Timeliness, string> = {
  on_time: "On time",
  late_same_day: "Late — same day",
  late_other_day: "Late — another day",
  no_deadline: "No due date set",
};
const EXPECTED_CHIP = "border-sky-200 bg-sky-100/70 text-sky-600";
const MISSED_CHIP = "border-terracotta/30 bg-terracotta-soft text-terracotta";

function personInitials(person?: { full_name?: string | null; username?: string | null } | null) {
  const name = person?.full_name?.trim() || person?.username?.trim();
  if (!name) return null;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export default function ClientSubmissionsCalendar({
  byDay,
  expectedByDay,
  anchor,
  onAnchorChange,
  orgTimezone,
  roundByItemId,
  onOpenTask,
}: {
  byDay: Map<string, ClientFeedItem[]>;
  expectedByDay: Map<string, ClientFeedItem[]>;
  anchor: Date;
  onAnchorChange: (d: Date) => void;
  orgTimezone: string;
  roundByItemId: Map<number, number>;
  onOpenTask: (taskId: number) => void;
}) {
  const [scale, setScale] = useState<CalendarScale>("month");
  const [customStart, setCustomStart] = useState(() => dayKey(anchor));
  const [customEnd, setCustomEnd] = useState(() => dayKey(shiftDays(anchor, 13)));
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const toggleExpanded = (day: string) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  const { cells, label } = useMemo(() => {
    const pad = (count: number) => Array.from({ length: count }, () => null);

    if (scale === "day") {
      return {
        cells: [{ day: dayKey(anchor), date: anchor.getDate() }] as Array<{ day: string; date: number } | null>,
        label: anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      };
    }

    if (scale === "week") {
      const start = shiftDays(anchor, -anchor.getDay());
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = shiftDays(start, i);
        return { day: dayKey(d), date: d.getDate() };
      });
      const end = shiftDays(start, 6);
      const from = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const to =
        start.getMonth() === end.getMonth()
          ? `${end.getDate()}, ${end.getFullYear()}`
          : `${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${end.getFullYear()}`;
      return { cells: days as Array<{ day: string; date: number } | null>, label: `${from} – ${to}` };
    }

    if (scale === "custom") {
      const start = parseDayKey(customStart);
      const end = parseDayKey(customEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        return { cells: [] as Array<{ day: string; date: number } | null>, label: "Pick a range" };
      }
      const span = Math.min(Math.round((end.getTime() - start.getTime()) / 86400000) + 1, MAX_CUSTOM_DAYS);
      const days = Array.from({ length: span }, (_, i) => {
        const d = shiftDays(start, i);
        return { day: dayKey(d), date: d.getDate() };
      });
      const last = shiftDays(start, span - 1);
      return {
        cells: [...pad(start.getDay()), ...days],
        label: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${span === MAX_CUSTOM_DAYS ? ` (first ${MAX_CUSTOM_DAYS} days)` : ""}`,
      };
    }

    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return { day: dayKey(d), date: i + 1 };
    });
    return { cells: [...pad(first.getDay()), ...days], label: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }, [scale, anchor, customStart, customEnd]);

  const step = (direction: 1 | -1) => {
    if (scale === "month") onAnchorChange(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    else if (scale === "week") onAnchorChange(shiftDays(anchor, 7 * direction));
    else onAnchorChange(shiftDays(anchor, direction));
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const chipLimit = CHIP_LIMIT[scale];

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
          {(["month", "week", "day", "custom"] as CalendarScale[]).map((option) => (
            <button
              key={option}
              onClick={() => {
                if (option === scale) return;
                setScale(option);
                if (option !== "custom") onAnchorChange(new Date());
                else {
                  const t = new Date();
                  setCustomStart(dayKey(shiftDays(t, -6)));
                  setCustomEnd(dayKey(t));
                }
              }}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                scale === option ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="text-xs font-bold uppercase tracking-wide text-espresso">{label}</p>

        {scale === "custom" ? (
          <div className="flex items-center gap-1">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-lg border border-sand bg-white px-2 py-1 text-[10px] text-espresso outline-none" />
            <span className="text-[10px] text-stone">to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-lg border border-sand bg-white px-2 py-1 text-[10px] text-espresso outline-none" />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20">← Prev</button>
            <button onClick={() => onAnchorChange(new Date())} className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20">Today</button>
            <button onClick={() => step(1)} className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20">Next →</button>
          </div>
        )}
      </div>

      <div className={scale === "day" ? "grid grid-cols-1" : "grid grid-cols-7 gap-1"}>
        {scale !== "day" &&
          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="pb-1 text-center text-[10px] font-semibold uppercase text-walnut">{d}</div>
          ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} className={`${CELL_HEIGHT[scale]} rounded-lg`} />;
          const dayItems = byDay.get(cell.day) ?? [];
          const forReview = dayItems.filter((item) => item.task?.review_required !== false);
          const auto = dayItems.filter((item) => item.task?.review_required === false);
          const expected = expectedByDay.get(cell.day) ?? [];
          const isToday = cell.day === today;
          const open = expandedDays.has(cell.day);
          const shownExpected = open ? expected : expected.slice(0, chipLimit);
          const shownForReview = open ? forReview : forReview.slice(0, chipLimit);
          const shownAuto = open ? auto : auto.slice(0, Math.max(1, Math.floor(chipLimit / 2)));
          const hidden = expected.length - shownExpected.length + (forReview.length - shownForReview.length) + (auto.length - shownAuto.length);

          const chipLabel = (item: ClientFeedItem) => {
            const memo = item.task?.task_detail?.trim();
            const withMemo = (scale === "week" || scale === "day") && memo;
            const tag = personInitials(item.profiles);
            return (
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {tag && <span className="mr-1 font-semibold opacity-60">{tag}</span>}
                  {item.task?.task_name ?? "Task"}
                </span>
                {withMemo && <span className={`block text-[8px] leading-snug opacity-75 ${scale === "day" ? "" : "truncate"}`}>{memo}</span>}
              </span>
            );
          };

          const chip = (item: ClientFeedItem, muted: boolean) => {
            const round = roundByItemId.get(item.id) ?? 0;
            const timeliness = timelinessOf(item.created_at, item.task, orgTimezone);
            return (
              <button
                key={item.id}
                onClick={() => item.task && onOpenTask(item.task.id)}
                title={`${item.task?.task_name ?? ""} — ${item.profiles?.full_name || item.profiles?.username || ""}${round > 0 ? ` (revision ${round})` : ""} — ${TIMELINESS_LABEL[timeliness]}${muted ? " — auto approved" : ""}`}
                className={`flex w-full items-start gap-1 rounded border px-1 py-[1px] text-left text-[9px] transition-opacity hover:opacity-80 ${TIMELINESS_CHIP[timeliness]} ${muted ? "opacity-60" : ""}`}
              >
                {chipLabel(item)}
                <RevisionBadge count={round} late={timeliness !== "on_time" && timeliness !== "no_deadline"} />
              </button>
            );
          };

          return (
            <div key={cell.day} className={`${CELL_HEIGHT[scale]} rounded-lg border p-1 ${isToday ? "border-terracotta bg-cream/60" : "border-sand bg-white"}`}>
              <p className="mb-0.5 text-[10px] font-semibold text-stone">
                {scale === "day" ? parseDayKey(cell.day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : cell.date}
              </p>
              <div className="space-y-0.5">
                {shownExpected.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="px-1 text-[8px] font-semibold uppercase tracking-wide text-stone">Expected</p>
                    {shownExpected.map((item) => {
                      const overdue = cell.day < today;
                      return (
                        <button
                          key={item.id}
                          onClick={() => item.task && onOpenTask(item.task.id)}
                          title={`${item.task?.task_name ?? ""} — ${item.profiles?.full_name || item.profiles?.username || ""} — ${overdue ? "due, nothing submitted" : "due"}`}
                          className={`flex w-full items-start gap-1 rounded border px-1 py-[1px] text-left text-[9px] transition-opacity hover:opacity-80 ${overdue ? MISSED_CHIP : EXPECTED_CHIP}`}
                        >
                          {chipLabel(item)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {shownForReview.map((item) => chip(item, false))}

                {shownAuto.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-sand pt-1">
                    <p className="px-1 text-[8px] font-semibold uppercase tracking-wide text-stone">Auto approved</p>
                    {shownAuto.map((item) => chip(item, true))}
                  </div>
                )}

                {hidden > 0 && (
                  <button onClick={() => toggleExpanded(cell.day)} className="px-1 text-[9px] text-stone hover:text-espresso">+{hidden} more</button>
                )}
                {open && dayItems.length + expected.length > chipLimit && (
                  <button onClick={() => toggleExpanded(cell.day)} className="px-1 text-[9px] text-stone hover:text-espresso">Show less</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
