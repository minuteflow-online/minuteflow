// "Your Team" — admin-only live roster, ported from src/components/TeamSidebar.tsx.
// Card header, avatar circles, status badges, and the per-member expandable
// task list are all copied from that component and AGENTS.md's patterns —
// same classes, same four-state status (Working/Personal/On Break/Offline).
// Only logic difference from web: lib/team.ts's fetchTeamRoster/
// fetchTeamTimeLogs do their own table-wide reads (profiles/sessions/
// time_logs) instead of the dashboard's single combined page-load fetch —
// see that file's comment on why that's safe under this app's direct-
// PostgREST-with-the-VA's-own-JWT pattern.
import { useState } from "react";
import {
  getMemberStatus,
  getStatusLabel,
  getStatusBadgeClass,
  getAvatarColor,
  getInitials,
  formatDuration,
  type TeamRosterMember,
  type TeamTimeLog,
} from "../lib/team";

interface TeamPanelProps {
  members: TeamRosterMember[];
  timeLogs: TeamTimeLog[];
  loading: boolean;
}

export default function TeamPanel({ members, timeLogs, loading }: TeamPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (memberId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const visibleMembers = members.filter((m) => getMemberStatus(m.session) !== "away");

  return (
    <div className="rounded-xl border border-sand bg-white p-4 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Your Team</h3>
        <span className="text-[11px] text-bark">
          {members.length} {members.length === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 overflow-y-auto min-h-0">
        {loading ? (
          [1, 2, 3].map((i) => <div key={i} className="animate-pulse h-12 w-full bg-parchment rounded-lg" />)
        ) : visibleMembers.length === 0 ? (
          <p className="text-xs text-stone py-4 text-center">No one's currently online.</p>
        ) : (
          visibleMembers.map((member, i) => {
            const status = getMemberStatus(member.session);
            const task = member.session?.active_task;
            const taskLabel = task
              ? [task.task_name, task.account || task.project].filter(Boolean).join(" · ")
              : "—";

            const memberLogs = timeLogs
              .filter((l) => l.user_id === member.profile.id)
              .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

            const isExpanded = expandedIds.has(member.profile.id);

            return (
              <div
                key={member.profile.id}
                className={`py-2.5 ${i < visibleMembers.length - 1 ? "border-b border-parchment" : ""}`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: getAvatarColor(i) }}
                  >
                    {getInitials(member.profile.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-espresso truncate">
                      {member.profile.full_name}
                    </div>
                    <div className="text-[10px] text-bark truncate">{taskLabel}</div>
                  </div>
                  <span
                    className={`text-[9px] font-semibold py-[2px] px-2 rounded-full whitespace-nowrap shrink-0 ${getStatusBadgeClass(status)}`}
                  >
                    {getStatusLabel(status)}
                  </span>
                </div>

                {memberLogs.length > 0 && (
                  <button
                    onClick={() => toggleExpand(member.profile.id)}
                    className="mt-1 ml-[38px] text-[10px] font-semibold text-bark hover:text-terracotta cursor-pointer transition-colors"
                  >
                    {isExpanded ? "▲ Hide" : "▼ Show"} tasks ({memberLogs.length})
                  </button>
                )}

                {isExpanded && memberLogs.length > 0 && (
                  <div className="mt-1.5 ml-[38px] space-y-1 max-h-[160px] overflow-y-auto">
                    {memberLogs.map((log) => {
                      const isActive = !log.end_time;
                      const duration =
                        log.duration_ms > 0
                          ? formatDuration(log.duration_ms)
                          : log.end_time
                            ? formatDuration(new Date(log.end_time).getTime() - new Date(log.start_time).getTime())
                            : "active";

                      return (
                        <div
                          key={log.id}
                          className={`flex items-center gap-1.5 py-1 px-2 rounded text-[10px] ${
                            isActive ? "bg-sage-soft/50" : "bg-parchment/40"
                          }`}
                        >
                          <div
                            className={`w-1 h-1 rounded-full shrink-0 ${
                              log.category === "Break"
                                ? "bg-stone"
                                : log.category === "Personal"
                                  ? "bg-clay-rose"
                                  : "bg-sage"
                            }`}
                          />
                          <span className="flex-1 truncate text-espresso font-medium">{log.task_name}</span>
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
          })
        )}
      </div>
    </div>
  );
}
