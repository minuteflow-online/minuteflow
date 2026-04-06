"use client";

const QUICK_ACTIONS = [
  { label: "Team Assist", action: "team-assist", icon: "\ud83e\udd1d", color: "bg-terracotta-soft text-terracotta" },
  { label: "Support Request", action: "support-request", icon: "\ud83c\udd98", color: "bg-clay-rose-soft text-clay-rose" },
  { label: "Training", action: "training", icon: "\ud83d\udcda", color: "bg-clay-rose-soft text-clay-rose" },
  { label: "Feedback", action: "feedback", icon: "\ud83d\udcac", color: "bg-parchment text-walnut" },
  { label: "Coaching/Review", action: "coaching-review", icon: "\ud83c\udfaf", color: "bg-sage-soft text-sage" },
  { label: "Weekly Meeting", action: "weekly-meeting", icon: "\ud83d\udcc5", color: "bg-slate-blue-soft text-slate-blue" },
  { label: "Unsched Meeting", action: "unscheduled-meeting", icon: "\ud83d\udde3\ufe0f", color: "bg-amber-soft text-amber" },
  { label: "Messaging", action: "messaging", icon: "\ud83d\udce8", color: "bg-slate-blue-soft text-slate-blue" },
  { label: "Sorting Tasks", action: "sorting-tasks", icon: "\ud83d\udccb", color: "bg-amber-soft text-amber" },
];

interface ProjectSidebarProps {
  onSelectProject: (account: string, project: string) => void;
  onQuickAction: (action: string) => void;
  isAdmin: boolean;
}

export default function ProjectSidebar({
  onQuickAction,
}: ProjectSidebarProps) {
  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-parchment px-4 py-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Quick Pick
        </h3>
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-3 gap-1.5">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.action}
              onClick={() => onQuickAction(qa.action)}
              className={`${qa.color} rounded-lg py-2 px-1 text-center cursor-pointer transition-all hover:opacity-80`}
            >
              <div className="text-sm leading-none mb-0.5">{qa.icon}</div>
              <div className="text-[9px] font-semibold leading-tight">{qa.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
