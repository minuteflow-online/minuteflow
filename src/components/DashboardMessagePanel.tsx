"use client";

// A compact message hub for the dashboard's left column, the same size as Quick
// Pick. Reuses the project message boards that already live in Objectives and
// Operations (project_messages + comments, @mentions, notifications) plus the
// in-app notification feed (the `messages` table the bell reads). Chat tabs
// (group / individual) are a later phase — this covers boards + comments.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Project = { id: string; name: string; kind?: string | null };
type Comment = { id: number; body: string; created_at: string; author?: string };
type Thread = {
  id: number; project_id: string; title: string; body: string;
  created_at: string; comment_count: number; comments: Comment[];
};
type Notif = { id: number; content: string; read: boolean; created_at: string };

type Tab = "objective" | "operation" | "comments";

function ago(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function DashboardMessagePanel({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<Tab>("objective");
  const [projects, setProjects] = useState<Project[]>([]);
  const [threadsByKind, setThreadsByKind] = useState<Record<string, Thread[]>>({ objective: [], operation: [] });
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [cProject, setCProject] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cBody, setCBody] = useState("");
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const kindProjects = useMemo(() => projects.filter((p) => p.kind === tab), [projects, tab]);

  // Boards: the user's objectives + operations, and the recent threads in each.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [obj, op] = await Promise.all([
          fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch("/api/projects?mine=true&kind=operation", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        const objs = ((obj.projects ?? []) as Project[]).map((p) => ({ ...p, kind: "objective" }));
        const ops = ((op.projects ?? []) as Project[]).map((p) => ({ ...p, kind: "operation" }));
        setProjects([...objs, ...ops]);
        const load = async (list: Project[]) => {
          const ids = list.map((p) => p.id).join(",");
          if (!ids) return [] as Thread[];
          const d = await fetch(`/api/projects/messages-overview?projectIds=${ids}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
          return (d.messages ?? []) as Thread[];
        };
        const [objThreads, opThreads] = await Promise.all([load(objs), load(ops)]);
        if (!cancelled) setThreadsByKind({ objective: objThreads, operation: opThreads });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Comments/notifications feed, realtime — the same rows the bell reads.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      const { data } = await supabase
        .from("messages").select("id, content, read, created_at")
        .eq("target_user_id", currentUserId)
        .order("created_at", { ascending: false }).limit(30);
      setNotifs((data ?? []) as Notif[]);
    };
    void load();
    channel = supabase.channel("dash-msg-panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `target_user_id=eq.${currentUserId}` }, () => void load())
      .subscribe();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [currentUserId]);

  const threads = threadsByKind[tab] ?? [];

  const submitReply = useCallback(async () => {
    if (!active || !reply.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/project-messages/${active.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (r.ok) { setReply(""); setReloadKey((k) => k + 1); const d = await r.json().catch(() => ({})); if (d.comment) setActive((a) => a ? { ...a, comments: [...a.comments, { id: d.comment.id, body: d.comment.body, created_at: d.comment.created_at }] } : a); }
    } finally { setSending(false); }
  }, [active, reply]);

  const submitPost = useCallback(async () => {
    if (!cProject || !cTitle.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/project-messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: cProject, title: cTitle.trim(), body: cBody.trim() }),
      });
      if (r.ok) { setCTitle(""); setCBody(""); setComposing(false); setReloadKey((k) => k + 1); }
    } finally { setSending(false); }
  }, [cProject, cTitle, cBody]);

  const input = "w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white";

  return (
    <div className="rounded-xl border border-sand bg-white shadow-sm flex flex-col h-[560px] overflow-hidden">
      <div className="px-3 py-2.5 border-b border-sand">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Messages</h3>
      </div>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2">
        {([["objective", "Objectives"], ["operation", "Operations"], ["comments", "Comments"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setActive(null); setComposing(false); }}
            className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors ${tab === k ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"}`}>
            {label}
            {k === "comments" && notifs.some((n) => !n.read) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-terracotta align-middle" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {/* Comments / notifications feed */}
        {tab === "comments" ? (
          notifs.length === 0 ? (
            <p className="text-[12px] text-walnut px-1 pt-2">No notifications yet. Mentions, submission comments, and job orders show here.</p>
          ) : (
            <div className="space-y-1.5">
              {notifs.map((n) => (
                <div key={n.id} className={`rounded-lg border px-2.5 py-2 text-[12px] ${n.read ? "border-sand bg-white text-walnut" : "border-terracotta/30 bg-terracotta-soft/30 text-espresso"}`}>
                  <p className="leading-snug">{n.content}</p>
                  <p className="mt-0.5 text-[10px] text-bark">{ago(n.created_at)} ago</p>
                </div>
              ))}
            </div>
          )
        ) : active ? (
          /* Thread view */
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setActive(null)} className="text-[10px] font-semibold text-slate-blue hover:underline self-start">← Back</button>
            <div className="rounded-lg border border-sand bg-cream/40 p-2.5">
              <p className="text-[12px] font-bold text-espresso">{active.title || "Untitled"}</p>
              {active.body && <p className="mt-1 text-[11px] text-espresso whitespace-pre-wrap">{active.body}</p>}
              <p className="mt-1 text-[10px] text-bark">{projectName.get(active.project_id) ?? "Project"} · {ago(active.created_at)} ago</p>
            </div>
            {active.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-sand bg-white px-2.5 py-1.5">
                <p className="text-[11px] text-espresso whitespace-pre-wrap">{c.body}</p>
                <p className="mt-0.5 text-[10px] text-bark">{c.author ? `${c.author} · ` : ""}{ago(c.created_at)} ago</p>
              </div>
            ))}
            <div className="flex items-end gap-1.5 pt-1">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply… (@name to tag)" className={`${input} resize-none flex-1`} />
              <button type="button" onClick={() => void submitReply()} disabled={sending || !reply.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 disabled:opacity-50 shrink-0">Send</button>
            </div>
          </div>
        ) : (
          /* Thread list + composer */
          <div className="space-y-2">
            {composing ? (
              <div className="space-y-1.5 rounded-lg border border-sand bg-cream/40 p-2">
                <select value={cProject} onChange={(e) => setCProject(e.target.value)} className={input}>
                  <option value="">Which {tab}…</option>
                  {kindProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Topic / title" className={input} />
                <textarea value={cBody} onChange={(e) => setCBody(e.target.value)} rows={2} placeholder="Write a message… (@name to tag)" className={`${input} resize-none`} />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setComposing(false)} className="px-2.5 py-1 rounded-lg bg-stone/15 text-stone text-[11px] font-semibold">Cancel</button>
                  <button type="button" onClick={() => void submitPost()} disabled={sending || !cProject || !cTitle.trim()}
                    className="px-2.5 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 disabled:opacity-50">Post</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setComposing(true); setCProject(kindProjects[0]?.id ?? ""); }}
                className="w-full rounded-lg border border-dashed border-sand py-1.5 text-[11px] font-semibold text-walnut hover:bg-cream transition-colors">+ New message</button>
            )}
            {loading ? (
              <p className="text-[12px] text-stone px-1">Loading…</p>
            ) : threads.length === 0 ? (
              <p className="text-[12px] text-walnut px-1">No threads yet.</p>
            ) : (
              threads.map((t) => (
                <button key={t.id} type="button" onClick={() => setActive(t)}
                  className="w-full text-left rounded-lg border border-sand bg-white px-2.5 py-2 hover:bg-cream transition-colors">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-espresso truncate">{t.title || "Untitled"}</span>
                    {t.comment_count > 0 && <span className="shrink-0 text-[10px] text-stone">{t.comment_count}</span>}
                  </span>
                  {t.body && <span className="block text-[11px] text-walnut truncate">{t.body}</span>}
                  <span className="block text-[10px] text-bark truncate">{projectName.get(t.project_id) ?? "Project"} · {ago(t.created_at)} ago</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
