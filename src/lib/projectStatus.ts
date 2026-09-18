// Objective/Operation status — shared by VAProjectsTab (the status
// dropdown/badges on a project) and ObjectiveOverview (the landing tile
// badges), so both read the exact same list rather than drifting apart.
//
// Values are the actual `projects.status` column values, unchanged from
// before this file existed — only the labels moved toward Toni's requested
// wording (Pending/In progress/Completed/Archived). "Reviewed" and
// "Approved" have no clean current equivalent, so "On hold" stays in their
// place rather than forcing a mismatched relabel.
export const PROJECT_STATUS_OPTIONS: { value: string; label: string; cls: string }[] = [
  { value: "planning", label: "Pending", cls: "bg-slate-blue-soft text-slate-blue border-slate-blue/20" },
  { value: "active", label: "In progress", cls: "bg-sage-soft text-sage border-sage/20" },
  { value: "on_hold", label: "On hold", cls: "bg-amber-50 text-amber-600 border-amber-200" },
  { value: "done", label: "Completed", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  { value: "archived", label: "Archived", cls: "bg-stone/10 text-stone border-stone/20" },
];
export const PROJECT_STATUS_BY_VALUE = new Map(PROJECT_STATUS_OPTIONS.map((s) => [s.value, s]));
