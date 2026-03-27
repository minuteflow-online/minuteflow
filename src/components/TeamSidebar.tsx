"use client";

import { useState } from "react";
import type { Session, Profile, TimeLog } from "@/types/database";
import { formatDuration } from "@/lib/utils";

interface TeamMember {
  profile: Profile;
  session: Session | null;
}

interface TeamSidebarProps {
  members: TeamMember[];
  timeLogs?: TimeLog[];
}

const AVATAR_COLORS = [
  "var(--color-terracotta)",
  "var(--color-sage)",
  "var(--color-clay-rose)",
  "var(--color-slate-blue)",
  "var(--color-walnut)",
  "var(--color-stone)",
  "var(--color-amber)",
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function getMemberStatus(
  session: Session | null
): "working" | "resting" | "away" {
  if (!session || !session.clocked_in) return "away";
  if (session.active_task?.isBreak) return "resting";
  return "working";
}

function getStatusLabel(status: "working" | "resting" | "away"): string {
  switch (status) {
    case "working":
      return "Working";
    case "resting":
      return "On Break";
    default:
      return "Offline";
  }
}

function getStatusBadgeClass(status: "working" | "resting" | "away"): string {
  switch (status) {
    case "working":
      return "bg-sage-soft text-sage";
    case "resting":
      return "bg-amber-soft text-amber";
    default:
      return "bg-parchment text-stone";
  }
}

export default function TeamSidebar({ members, timeLogs = [] }: TeamSidebarProps) {
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const toggleExpand = (memberId: string) => {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  // Get today's start for filtering (in case logs from other days sneak in)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return (
    <div className="bg-white border border-sand rounded-xl">
      <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
        <h3 className="text-sm font-bold text-espresso">Your Team</h3>
        <span className="text-[11px] text-bark">
          {members.length} {members.length === 1 ? "person" : "people"}
        </span>
      </div>
      <div className="p-[18px_20px]">
        {members.map((member, i) => {
          const status = getMemberStatus(member.session);
          const currentTask = member.session?.active_task;
          const taskLabel = currentTask
            ? [
                currentTask.task_name,
                currentTask.account || currentTask.project,
              ]
                .filter(Boolean)
                .join(" \u00B7 ")
            : "\u2014";

          // Get this member's today logs
          const memberLogs = timeLogs
            .filter((l) => l.user_id === member.profile.id)
            .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

          const isExpanded = expandedMembers.has(member.profile.id);

          return (
            <div
              key={member.profile.id}
              className={`py-[11px] ${
                i < members.length - 1
                  ? "border-b border-parchment"
                  : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: getAvatarColor(i) }}
                >
                  {getInitials(member.profile.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-espresso">
                    {member.profile.full_name}
                  </div>
                  <div className="text-[11px] text-bark whitespace-nowrap overflow-hidden text-ellipsis">
                    {taskLabel}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold py-[3px] px-2.5 rounded-full whitespace-nowrap ${getStatusBadgeClass(status)}`}
                >
                  {getStatusLabel(status)}
                </span>
              </div>

              {/* Expand toggle */}
              {memberLogs.length > 0 && (
                <button
                  onClick={() => toggleExpand(member.profile.id)}
                  className="mt-1.5 ml-[46px] text-[10px] font-semibold text-bark hover:text-terracotta cursor-pointer transition-colors"
                >
                  {isExpanded ? "\u25B2 Hide" : "\u25BC Show"} tasks ({memberLogs.length})
                </button>
              )}

              {/* Expanded task list */}
              {isExpanded && memberLogs.length > 0 && (
                <div className="mt-1.5 ml-[46px] space-y-1 max-h-[180px] overflow-y-auto">
                  {memberLogs.map((log) => {
                    const startTime = new Date(log.start_time).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    });
                    const duration = log.duration_ms > 0
                      ? formatDuration(log.duration_ms)
                      : log.end_time
                        ? formatDuration(new Date(log.end_time).getTime() - new Date(log.start_time).getTime())
                        : "active";
                    const isActive = !log.end_time;

                    return (
                      <div
                        key={log.id}
                        className={`flex items-center gap-1.5 py-1 px-2 rounded text-[10px] ${
                          isActive ? "bg-sage-soft/50" : "bg-parchment/40"
                        }`}
                      >
                        <div className={`w-1 h-1 rounded-full shrink-0 ${
                          log.category === "Break" ? "bg-stone" :
                          log.category === "Personal" ? "bg-clay-rose" :
                          "bg-sage"
                        }`} />
                        <span className="flex-1 truncate text-espresso font-medium">
                          {log.task_name}
                        </span>
                        <span className={`shrink-0 ${isActive ? "text-sage font-semibold" : "text-stone"}`}>
                          {duration}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="text-xs text-stone py-4 text-center">
            No team members found
          </p>
        )}
      </div>
    </div>
  );
}
