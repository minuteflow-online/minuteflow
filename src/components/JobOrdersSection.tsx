"use client";

// Job Orders — offer a scoped piece of work to one VA, who accepts or declines.
// Lives at the top of the Assignment page, above the available/grab tasks.
// Admins create orders; only the Founder may set/see the rate ($); the offeree
// accepts (→ becomes a real subtask) or declines (→ back to the creator).
// See the spec: Productivity Hub · Job Orders.

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasBroadAdminAccess, isFounder } from "@/lib/financialAccess";

type Member = { id: string; full_name?: string | null; username?: string | null };
type ProjectOpt = { id: string; name: string; kind?: string | null };

export type JobOrder = {
  id: string;
  title: string;
  type: "objective" | "operation" | "adhoc";
  linked_project_id: string | null;
  create_later: boolean;
  project: string | null;
  task_title: string | null;
  account: string | null;
  details: string | null;
  links: string[] | null;
  work_type: "output" | "time";
  rate: number | null;
  time_frame: string | null;
  start_date: string | null;
  deadline: string | null;
  review_required: boolean;
  priority: "low" | "med" | "high" | "urgent";
  offered_to: string;
  created_by: string;
  respond_by: string | null;
  status: "offered" | "accepted" | "declined" | "expired";
  decline_reason: string | null;
  accepted_task_id: number | null;
  accepted_at: string | null;
  created_at: string;
};

const PRIORITY_CLS: Record<string, string> = {
  low: "bg-stone/10 text-stone border-stone/20",
  med: "bg-slate-blue-soft text-slate-blue border-slate-blue/20",
  high: "bg-amber-soft text-amber border-amber/30",
  urgent: "bg-terracotta-soft text-terracotta border-terracotta/30",
};
const STATUS_CLS: Record<string, string> = {
  offered: "bg-amber-soft text-amber border-amber/30",
  accepted: "bg-sage-soft text-sage border-sage/20",
  declined: "bg-terracotta-soft text-terracotta border-terracotta/30",
  expired: "bg-stone/10 text-stone border-stone/20",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}
const nameOf = (m?: Member | null) => (m ? m.full_name || m.username || "—" : "—");

export default function JobOrdersSection({
  currentUserId,
  currentRole,
  teamMembers,
}: {
  currentUserId: string;
  currentRole: string | null;
  teamMembers: Member[];
}) {
  const profile = { role: currentRole };
  const admin = hasBroadAdminAccess(profile);
  const founder = isFounder(profile);

  const [open, setOpen] = useState(true);
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.id, m])), [teamMembers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/job-orders", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled) setOrders((d.orders ?? []) as JobOrder[]);
      } catch { if (!cancelled) setOrders([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  // Objectives + operations for the "link to" dropdown (admins only).
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch("/api/projects?mine=true&kind=operation", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        const objs = ((a.projects ?? []) as ProjectOpt[]).map((p) => ({ ...p, kind: "objective" }));
        const ops = ((b.projects ?? []) as ProjectOpt[]).map((p) => ({ ...p, kind: "operation" }));
        setProjects([...objs, ...ops]);
      } catch { if (!cancelled) setProjects([]); }
    })();
    return () => { cancelled = true; };
  }, [admin]);

  const act = useCallback(async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/job-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) setReload((k) => k + 1);
      else { const d = await r.json().catch(() => ({})); alert(d.error || "Something went wrong."); }
    } finally { setBusyId(null); }
  }, []);

  const offeredToMe = orders.filter((o) => o.offered_to === currentUserId && o.status === "offered");
  const rest = orders.filter((o) => !(o.offered_to === currentUserId && o.status === "offered"));

  const Row = ({ o }: { o: JobOrder }) => {
    const isOfferee = o.offered_to === currentUserId;
    const isExp = expanded === o.id;
    const canRespond = isOfferee && o.status === "offered";
    return (
      <div className="rounded-lg border border-sand bg-white overflow-hidden">
        <div className="w-full flex items-center gap-2 px-3 py-2.5">
          <button type="button" onClick={() => setExpanded(isExp ? null : o.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
            <span className="text-bark text-[9px] w-2 shrink-0">{isExp ? "▼" : "▶"}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-espresso leading-tight truncate">{o.title}</span>
              <span className="block text-[11px] text-stone/80 truncate">
                {[o.task_title || o.project, o.account].filter(Boolean).join(" · ")}
                {o.deadline ? ` · Due ${fmtDate(o.deadline)}` : ""}
                {o.rate != null ? ` · $${o.rate}` : ""}
              </span>
            </span>
          </button>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${PRIORITY_CLS[o.priority]}`}>{o.priority}</span>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CLS[o.status]}`}>{o.status}</span>
          {canRespond && (
            <span className="flex items-center gap-1 shrink-0">
              <button disabled={busyId === o.id} onClick={() => void act(o.id, { action: "accept" })}
                className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors disabled:opacity-50">Accept</button>
              <button disabled={busyId === o.id} onClick={() => { const reason = prompt("Reason for declining (optional):") ?? ""; void act(o.id, { action: "decline", reason }); }}
                className="px-2.5 py-1 rounded-lg text-[10px] font-semibold border border-terracotta/40 text-terracotta hover:border-terracotta transition-colors disabled:opacity-50">Decline</button>
            </span>
          )}
        </div>
        {isExp && (
          <div className="border-t border-sand text-[12px]">
            {([
              ["Offered to", nameOf(memberById.get(o.offered_to))],
              ["Type", o.type === "adhoc" ? "Adhoc" : (o.create_later ? `${o.type} · create later` : (projects.find((p) => p.id === o.linked_project_id)?.name ?? o.type))],
              ["Project", o.project],
              ["Task title", o.task_title],
              ["Account", o.account],
              ["Work type", o.work_type === "output" ? "Output based" : "Time based"],
              [o.work_type === "output" ? "Rate" : "Time frame", o.work_type === "output" ? (o.rate != null ? `$${o.rate}` : (founder ? "— (set a rate)" : "hidden")) : o.time_frame],
              ["Start date", o.start_date ? fmtDate(o.start_date) : null],
              ["Deadline", o.deadline ? fmtDate(o.deadline) : null],
              ["Respond by", o.respond_by ? fmtDate(o.respond_by) : null],
              ["Review required", o.review_required ? "Yes" : "No"],
              ["Details", o.details],
              ["Links", o.links && o.links.length ? o.links.join(", ") : null],
              ["Declined reason", o.decline_reason],
            ] as [string, string | null | undefined][]).map(([label, value]) => (
              <div key={label} className="flex border-b border-sand/60">
                <div className="w-32 shrink-0 bg-parchment/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-walnut">{label}</div>
                <div className={`flex-1 px-3 py-1.5 whitespace-pre-wrap ${value ? "text-espresso" : "text-stone/50"}`}>{value || "--"}</div>
              </div>
            ))}
            {(founder && o.work_type === "output") && (
              <div className="flex items-center gap-2 p-2">
                <button onClick={() => { const v = prompt("Set the rate ($):", o.rate != null ? String(o.rate) : ""); if (v == null) return; const n = Number(v); if (!Number.isNaN(n)) void act(o.id, { action: "set_rate", rate: n }); }}
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-amber text-white hover:bg-amber/90 transition-colors">Set rate</button>
                {(admin && o.status === "offered") && (
                  <button onClick={() => void act(o.id, { action: "cancel" })}
                    className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/15 text-stone hover:bg-stone/25 transition-colors">Cancel offer</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-sand bg-cream/40 p-3 mb-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2">
          <span className="text-amber text-[10px] w-3 shrink-0">{open ? "▼" : "▶"}</span>
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Job Orders</h3>
          {offeredToMe.length > 0 && (
            <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-soft text-amber border border-amber/30">{offeredToMe.length} offered to you</span>
          )}
        </button>
        {admin && open && (
          <button type="button" onClick={() => setCreating((v) => !v)}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors">
            {creating ? "Cancel" : "+ Job Order"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {creating && admin && (
            <CreateForm
              teamMembers={teamMembers}
              projects={projects}
              founder={founder}
              onDone={() => { setCreating(false); setReload((k) => k + 1); }}
            />
          )}

          {loading ? (
            <p className="text-[12px] text-stone">Loading…</p>
          ) : orders.length === 0 ? (
            <p className="text-[12px] text-walnut">No job orders yet.{admin ? " Use “+ Job Order” to offer work." : ""}</p>
          ) : (
            <>
              {offeredToMe.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Offered to you</p>
                  {offeredToMe.map((o) => <Row key={o.id} o={o} />)}
                </div>
              )}
              {rest.length > 0 && (
                <div className="space-y-1.5">
                  {offeredToMe.length > 0 && <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">{admin ? "All orders" : "Your orders"}</p>}
                  {rest.map((o) => <Row key={o.id} o={o} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create form ─────────────────────────────────────────────────────────────
function CreateForm({
  teamMembers, projects, founder, onDone,
}: {
  teamMembers: Member[];
  projects: ProjectOpt[];
  founder: boolean;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [offeredTo, setOfferedTo] = useState("");
  const [type, setType] = useState<"objective" | "operation" | "adhoc">("adhoc");
  const [linkMode, setLinkMode] = useState<"existing" | "later">("existing");
  const [linkedId, setLinkedId] = useState("");
  const [project, setProject] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [account, setAccount] = useState("");
  const [details, setDetails] = useState("");
  const [links, setLinks] = useState("");
  const [workType, setWorkType] = useState<"output" | "time">("time");
  const [rate, setRate] = useState("");
  const [timeFrame, setTimeFrame] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [respondBy, setRespondBy] = useState("");
  const [reviewRequired, setReviewRequired] = useState(false);
  const [priority, setPriority] = useState<"low" | "med" | "high" | "urgent">("med");
  const [saving, setSaving] = useState(false);

  const linkable = projects.filter((p) => p.kind === type);
  const inputCls = "w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white";
  const labelCls = "block text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1";

  const submit = async () => {
    if (!title.trim() || !offeredTo) return;
    setSaving(true);
    try {
      const r = await fetch("/api/job-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          offered_to: offeredTo,
          type,
          linked_project_id: type !== "adhoc" && linkMode === "existing" ? (linkedId || null) : null,
          create_later: type !== "adhoc" && linkMode === "later",
          project: project || null,
          task_title: taskTitle || null,
          account: account || null,
          details: details || null,
          links: links.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          work_type: workType,
          rate: founder && workType === "output" && rate ? Number(rate) : null,
          time_frame: workType === "time" ? (timeFrame || null) : null,
          start_date: startDate || null,
          deadline: deadline || null,
          respond_by: respondBy || null,
          review_required: reviewRequired,
          priority,
        }),
      });
      if (r.ok) onDone();
      else { const d = await r.json().catch(() => ({})); alert(d.error || "Couldn't create the order."); }
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-sand bg-white p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>Title (client memo)</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Young Enterprise Lab — donate page copy" />
        </div>
        <div>
          <label className={labelCls}>Offer to</label>
          <select className={inputCls} value={offeredTo} onChange={(e) => setOfferedTo(e.target.value)}>
            <option value="">Select a VA…</option>
            {teamMembers.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="adhoc">Adhoc</option>
            <option value="objective">Objective</option>
            <option value="operation">Operation</option>
          </select>
        </div>
        {type !== "adhoc" && (
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Link</label>
              <select className={inputCls} value={linkMode} onChange={(e) => setLinkMode(e.target.value as "existing" | "later")}>
                <option value="existing">Link to an existing {type}</option>
                <option value="later">Create later (VA creates it on accept)</option>
              </select>
            </div>
            {linkMode === "existing" && (
              <div>
                <label className={labelCls}>{type === "objective" ? "Objective" : "Operation"}</label>
                <select className={inputCls} value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
                  <option value="">Select…</option>
                  {linkable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>Project</label>
          <input className={inputCls} value={project} onChange={(e) => setProject(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Task title</label>
          <input className={inputCls} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Account {founder ? "" : "(Founder assigns)"}</label>
          <input className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)} disabled={!founder} placeholder={founder ? "" : "—"} />
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="low">Low</option><option value="med">Med</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Work type</label>
          <select className={inputCls} value={workType} onChange={(e) => setWorkType(e.target.value as "output" | "time")}>
            <option value="time">Time based</option><option value="output">Output based</option>
          </select>
        </div>
        {workType === "output" ? (
          <div>
            <label className={labelCls}>Rate ($) {founder ? "" : "(Founder only)"}</label>
            <input className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} disabled={!founder} inputMode="decimal" placeholder={founder ? "" : "set by Founder"} />
          </div>
        ) : (
          <div>
            <label className={labelCls}>Time frame</label>
            <input className={inputCls} value={timeFrame} onChange={(e) => setTimeFrame(e.target.value)} placeholder="e.g. 3 hrs" />
          </div>
        )}
        <div>
          <label className={labelCls}>Start date</label>
          <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Deadline</label>
          <input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Respond by</label>
          <input type="date" className={inputCls} value={respondBy} onChange={(e) => setRespondBy(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Details</label>
          <textarea className={`${inputCls} resize-none`} rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Links (one per line)</label>
          <textarea className={`${inputCls} resize-none`} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-espresso">
          <input type="checkbox" className="accent-sage" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />
          Review required
        </label>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={saving || !title.trim() || !offeredTo}
          className="px-4 py-1.5 rounded-lg bg-sage text-white text-[12px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50">
          {saving ? "Offering…" : "Offer job order"}
        </button>
      </div>
    </div>
  );
}
