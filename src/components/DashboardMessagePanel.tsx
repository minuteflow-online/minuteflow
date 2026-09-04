"use client";

// The dashboard's message inbox (under Quick Pick). Three tabs:
//  • General  — objective + operation message boards, merged. Start a topic,
//               search and filter them, read, reply, and bin one here.
//  • Personal — direct messages and group chats (conversations + direct_messages).
//  • Comments — the in-app notification feed (the `messages` table the bell reads):
//               submission comments, @mentions, job orders, and new DMs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getInitials, getAvatarColor } from "@/lib/utils";

type Project = { id: string; name: string };
type Comment = { id: number; body: string; created_at: string; author?: string; author_id?: string | null };
type Thread = { id: number; project_id: string; title: string; body: string; created_at: string; comment_count: number; comments: Comment[]; author_id?: string | null };
type Notif = { id: number; content: string; read: boolean; created_at: string; kind?: string | null };
type Member = { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null };
type Conversation = { id: string; is_group: boolean; title: string; members: { id: string; name: string }[]; last_message: { body: string; created_at: string; mine: boolean } | null; unread: number; updated_at: string };
type DM = { id: number; body: string; created_at: string; mine: boolean; sender_name: string; sender_id?: string | null };

type Tab = "general" | "personal" | "comments";

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const nameOf = (m: Member) => m.full_name || m.username || "?";

/**
 * A person, small. Their photo when they have one, otherwise the initials
 * circle used everywhere else in the app, coloured from their name so the same
 * person is the same colour wherever they appear.
 */
function Avatar({ member, name, size = 18 }: { member?: Member; name?: string; size?: number }) {
  const label = member ? nameOf(member) : name || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (member?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={member.avatar_url}
        alt={label}
        title={label}
        style={style}
        className="rounded-full object-cover shrink-0 border border-white"
      />
    );
  }
  return (
    <span
      title={label}
      style={{ ...style, backgroundColor: getAvatarColor(label) }}
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 border border-white"
    >
      {getInitials(label)}
    </span>
  );
}

export default function DashboardMessagePanel({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<Tab>("general");
  // Expanded moves this exact panel into an overlay rather than rendering a
  // second copy, so whatever you were reading or typing survives the switch.
  const [expanded, setExpanded] = useState(false);
  // General has no read state of its own, so "new" means posted since you last
  // had the tab open. Kept per person in localStorage — this is an attention
  // cue, not a record, so it does not need to survive a new browser.
  const [lastSeenGeneral, setLastSeenGeneral] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // ── General (objective + operation threads) ────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [gLoading, setGLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [composingTopic, setComposingTopic] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicBody, setTopicBody] = useState("");
  const [busyThread, setBusyThread] = useState<number | null>(null);
  // Trashed topics are hidden from everyone; an admin can read them back here
  // and put one returned. The endpoint answers with isAdmin so the Trash option
  // is simply absent for everyone else.
  const [trashed, setTrashed] = useState<Thread[]>([]);
  const [canSeeTrash, setCanSeeTrash] = useState(false);
  // Typing "@" opens a name list; picking one completes the mention. Keyed by
  // which box is being typed in, so the reply box and the topic body can each
  // have their own picker without sharing state.
  const [mentionFor, setMentionFor] = useState<"reply" | "topic" | "dm" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");

  // ── Comments feed ──────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Notif[]>([]);

  // ── Personal (DMs + groups) ────────────────────────────────────────────────
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [dms, setDms] = useState<DM[]>([]);
  const [dmText, setDmText] = useState("");
  // team excludes you, because the DM picker should not offer you yourself.
  // Avatars need everyone including you, or your own posts render as "?".
  const [team, setTeam] = useState<Member[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [composingChat, setComposingChat] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [sending, setSending] = useState(false);
  const dmEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setLastSeenGeneral(localStorage.getItem(`mf-msg-seen:${currentUserId}`));
    } catch {
      // Private window or blocked storage — everything just reads as seen.
    }
  }, [currentUserId]);

  // Opening General marks it read, so the cue clears the moment you look.
  useEffect(() => {
    if (tab !== "general") return;
    const now = new Date().toISOString();
    setLastSeenGeneral(now);
    try {
      localStorage.setItem(`mf-msg-seen:${currentUserId}`, now);
    } catch {
      // Nothing to do — the badge simply will not persist.
    }
  }, [tab, currentUserId, threads]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const memberById = useMemo(() => new Map(allMembers.map((m) => [m.id, m])), [allMembers]);

  /** Everyone who has said something in a topic: its author, then repliers. */
  const participantsOf = (t: Thread) => {
    const ids: string[] = [];
    if (t.author_id) ids.push(t.author_id);
    for (const c of t.comments ?? []) if (c.author_id && !ids.includes(c.author_id)) ids.push(c.author_id);
    return ids;
  };

  // Threads narrowed by the search box and the project dropdown. Matching on
  // title, body and project name, so typing an objective name finds its topics.
  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (projectFilter !== "all" && (t.title || "Untitled") !== projectFilter) return false;
      if (!q) return true;
      return (
        (t.title ?? "").toLowerCase().includes(q) ||
        (t.body ?? "").toLowerCase().includes(q) ||
        (projectName.get(t.project_id) ?? "").toLowerCase().includes(q)
      );
    });
  }, [threads, search, projectFilter, projectName]);

  useEffect(() => {
    fetch("/api/project-messages/trash", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setCanSeeTrash(Boolean(d.isAdmin));
        setTrashed((d.messages ?? []) as Thread[]);
      })
      .catch(() => {});
  }, [reloadKey]);

  const restoreThread = useCallback(async (t: Thread) => {
    setBusyThread(t.id);
    try {
      const r = await fetch("/api/project-messages/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      if (r.ok) setReloadKey((k) => k + 1);
    } finally {
      setBusyThread(null);
    }
  }, []);

  // The dropdown lists the topics themselves — what people named them.
  const topicTitles = useMemo(
    () => Array.from(new Set(threads.map((t) => t.title || "Untitled"))).sort(),
    [threads]
  );

  // The partial name being typed after an "@", or null when the caret is not
  // in a mention. Only the run of characters since the last "@" counts, and a
  // space closes it — "@ann smith" is a finished mention plus a word.
  const mentionFragment = (text: string) => {
    const at = text.lastIndexOf("@");
    if (at === -1) return null;
    const after = text.slice(at + 1);
    if (/\s/.test(after)) return null;
    return after;
  };

  const onMentionInput = (value: string, which: "reply" | "topic" | "dm") => {
    const frag = mentionFragment(value);
    if (frag === null) {
      setMentionFor(null);
      setMentionQuery("");
    } else {
      setMentionFor(which);
      setMentionQuery(frag);
    }
  };

  const applyMention = (
    text: string,
    member: Member,
    set: (v: string) => void
  ) => {
    const at = text.lastIndexOf("@");
    set(text.slice(0, at) + "@" + nameOf(member) + " ");
    setMentionFor(null);
    setMentionQuery("");
  };

  const mentionMatches = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const list = q ? team.filter((m) => nameOf(m).toLowerCase().includes(q)) : team;
    return list.slice(0, 6);
  }, [team, mentionQuery]);

  const createTopic = useCallback(async () => {
    if (!topicTitle.trim() || !topicBody.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/project-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: topicTitle.trim(), body: topicBody.trim() }),
      });
      if (r.ok) {
        setComposingTopic(false);
        setTopicTitle("");
        setTopicBody("");
        setReloadKey((k) => k + 1);
      }
    } finally {
      setSending(false);
    }
  }, [topicTitle, topicBody]);

  // Soft delete: the route stamps deleted_at, so the topic leaves every list
  // without the replies underneath it being destroyed. Author or admin only,
  // enforced server-side.
  const trashThread = useCallback(
    async (t: Thread) => {
      if (!confirm(`Move "${t.title || "Untitled"}" to trash?\n\nIt disappears from Messages. Replies are kept.`)) return;
      setBusyThread(t.id);
      try {
        const r = await fetch(`/api/project-messages?id=${t.id}`, { method: "DELETE" });
        if (r.ok) {
          setActiveThread(null);
          setReloadKey((k) => k + 1);
        }
      } finally {
        setBusyThread(null);
      }
    },
    []
  );

  // General: objectives + operations and their threads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGLoading(true);
      try {
        const [obj, op] = await Promise.all([
          fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch("/api/projects?mine=true&kind=operation", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        const all = [...((obj.projects ?? []) as Project[]), ...((op.projects ?? []) as Project[])];
        setProjects(all);
        const ids = all.map((p) => p.id).join(",");
        const [fromProjects, general] = await Promise.all([
          ids
            ? fetch(`/api/projects/messages-overview?projectIds=${ids}`, { cache: "no-store" })
                .then((r) => r.json())
                .catch(() => ({}))
            : Promise.resolve({}),
          fetch("/api/project-messages?general=1", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({})),
        ]);
        if (cancelled) return;
        const merged = [
          ...((general.messages ?? []) as Thread[]),
          ...((fromProjects.messages ?? []) as Thread[]),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setThreads(merged);
      } finally { if (!cancelled) setGLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Comments feed, realtime.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      // Comments is for remarks on work — submissions, mentions, job orders.
      // A direct message belongs in Personal and nowhere else.
      const { data } = await supabase
        .from("messages")
        .select("id, content, read, created_at, kind")
        .eq("target_user_id", currentUserId)
        .or("kind.is.null,kind.neq.message")
        .order("created_at", { ascending: false })
        .limit(30);
      setNotifs((data ?? []) as Notif[]);
    };
    void load();
    channel = supabase.channel("dash-inbox").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `target_user_id=eq.${currentUserId}` }, () => { void load(); setReloadKey((k) => k + 1); }).subscribe();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [currentUserId]);

  // Personal: conversations + team list. Poll while on the Personal tab.
  const loadConvs = useCallback(async () => {
    const d = await fetch("/api/conversations", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setConvs((d.conversations ?? []) as Conversation[]);
  }, []);
  useEffect(() => { void loadConvs(); }, [loadConvs, reloadKey]);
  useEffect(() => {
    if (tab !== "personal") return;
    const t = setInterval(() => void loadConvs(), 15000);
    return () => clearInterval(t);
  }, [tab, loadConvs]);
  useEffect(() => {
    fetch("/api/team-members", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const members = (d.members ?? []) as Member[];
        setAllMembers(members);
        setTeam(members.filter((m) => m.id !== currentUserId));
      })
      .catch(() => {});
  }, [currentUserId]);

  const openConv = useCallback(async (c: Conversation) => {
    setActiveConv(c);
    const d = await fetch(`/api/conversations/${c.id}/messages`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setDms((d.messages ?? []) as DM[]);
    void loadConvs();
    setTimeout(() => dmEndRef.current?.scrollIntoView({ block: "end" }), 50);
  }, [loadConvs]);

  // Poll the open conversation's messages.
  useEffect(() => {
    if (tab !== "personal" || !activeConv) return;
    const t = setInterval(async () => {
      const d = await fetch(`/api/conversations/${activeConv.id}/messages`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      setDms((d.messages ?? []) as DM[]);
    }, 8000);
    return () => clearInterval(t);
  }, [tab, activeConv]);

  const sendDm = useCallback(async () => {
    if (!activeConv || !dmText.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/conversations/${activeConv.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: dmText.trim() }) });
      if (r.ok) { const d = await r.json(); setDms((prev) => [...prev, d.message]); setDmText(""); void loadConvs(); setTimeout(() => dmEndRef.current?.scrollIntoView({ block: "end" }), 50); }
    } finally { setSending(false); }
  }, [activeConv, dmText, loadConvs]);

  const startChat = useCallback(async () => {
    const ids = Array.from(picked);
    if (ids.length === 0) return;
    setSending(true);
    try {
      const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member_ids: ids, title: groupTitle.trim() || null, is_group: ids.length > 1 }) });
      if (r.ok) {
        const d = await r.json();
        setComposingChat(false); setPicked(new Set()); setGroupTitle("");
        await loadConvs();
        const conv = (await fetch("/api/conversations", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}))).conversations?.find((c: Conversation) => c.id === d.conversation_id);
        if (conv) void openConv(conv);
      }
    } finally { setSending(false); }
  }, [picked, groupTitle, loadConvs, openConv]);

  const submitReply = useCallback(async () => {
    if (!activeThread || !reply.trim()) return;
    const r = await fetch(`/api/project-messages/${activeThread.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: reply.trim() }) });
    if (r.ok) { const d = await r.json().catch(() => ({})); setReply(""); if (d.comment) setActiveThread((a) => a ? { ...a, comments: [...a.comments, { id: d.comment.id, body: d.comment.body, created_at: d.comment.created_at }] } : a); setReloadKey((k) => k + 1); }
  }, [activeThread, reply]);

  const input = "w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white";
  const unreadTotal = convs.reduce((n, c) => n + c.unread, 0);
  const hasNewComments = notifs.some((n) => !n.read);

  // A topic or a reply posted since you last opened General, by someone else.
  const newGeneralCount = useMemo(() => {
    if (!lastSeenGeneral) return 0;
    let n = 0;
    for (const t of threads) {
      if (t.author_id !== currentUserId && t.created_at > lastSeenGeneral) n += 1;
      for (const c of t.comments ?? []) {
        if (c.author_id !== currentUserId && c.created_at > lastSeenGeneral) n += 1;
      }
    }
    return n;
  }, [threads, lastSeenGeneral, currentUserId]);

  // Anything at all worth looking at, for the header cue.
  const hasAnythingNew = unreadTotal > 0 || hasNewComments || newGeneralCount > 0;

  const panel = (
    <div
      className={`rounded-xl border border-amber/30 bg-amber-soft/25 shadow-sm flex flex-col overflow-hidden ${
        expanded ? "h-[80vh] bg-white" : "h-[520px]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-amber/20 bg-amber-soft/50">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-espresso uppercase tracking-wide">
          Messages
          {hasAnythingNew && (
            <span className="relative flex h-2 w-2" title="New messages">
              {/* Ping ring plus a solid centre: the pulse draws the eye, the
                  dot stays legible once it fades. */}
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-terracotta opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-terracotta" />
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Close" : "Expand"}
          aria-label={expanded ? "Close expanded messages" : "Expand messages"}
          className="text-[12px] leading-none text-bark hover:text-espresso transition-colors px-1"
        >
          {expanded ? "\u2715" : "\u2922"}
        </button>
      </div>
      <div className="flex items-center gap-1 px-2 pt-2">
        {([["general", "General"], ["personal", "Personal"], ["comments", "Comments"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setActiveThread(null); setActiveConv(null); setComposingChat(false); }}
            className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors ${tab === k ? "bg-amber-soft text-amber border border-amber/30" : "bg-stone/10 text-stone hover:bg-stone/20"}`}>
            {label}
            {k === "general" && newGeneralCount > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-terracotta text-white text-[8px] align-middle animate-pulse">{newGeneralCount}</span>}
            {k === "personal" && unreadTotal > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-terracotta text-white text-[8px] align-middle animate-pulse">{unreadTotal}</span>}
            {k === "comments" && hasNewComments && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-terracotta align-middle animate-pulse" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {/* ── Comments ── */}
        {tab === "comments" ? (
          notifs.length === 0 ? <p className="text-[12px] text-walnut px-1 pt-2">No notifications yet.</p> : (
            <div className="space-y-1.5">
              {notifs.map((n) => (
                <div key={n.id} className={`rounded-lg border px-2.5 py-2 text-[12px] ${n.read ? "border-sand bg-white text-walnut" : "border-terracotta/30 bg-terracotta-soft/30 text-espresso"}`}>
                  <p className="leading-snug">{n.content}</p>
                  <p className="mt-0.5 text-[10px] text-bark">{ago(n.created_at)} ago</p>
                </div>
              ))}
            </div>
          )
        ) : tab === "general" ? (
          /* ── General ── */
          activeThread ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setActiveThread(null)} className="text-[10px] font-semibold text-slate-blue hover:underline">← Back</button>
                <button
                  type="button"
                  onClick={() => void trashThread(activeThread)}
                  disabled={busyThread === activeThread.id}
                  className="text-[10px] font-semibold text-bark hover:text-terracotta transition-colors disabled:opacity-50"
                >
                  Trash
                </button>
              </div>
              <div className="rounded-lg border border-sand bg-cream/40 p-2.5">
                <p className="text-[12px] font-bold text-espresso">{activeThread.title || "Untitled"}</p>
                {activeThread.body && <p className="mt-1 text-[11px] text-espresso whitespace-pre-wrap">{activeThread.body}</p>}
                <p className="mt-1 text-[10px] text-bark">{projectName.get(activeThread.project_id) ?? "Project"} · {ago(activeThread.created_at)} ago</p>
              </div>
              {activeThread.comments.map((c) => (
                <div key={c.id} className="flex gap-1.5">
                  <Avatar member={c.author_id ? memberById.get(c.author_id) : undefined} name={c.author} size={20} />
                  <div className="flex-1 min-w-0 rounded-lg border border-sand bg-white px-2.5 py-1.5">
                    <p className="text-[11px] text-espresso whitespace-pre-wrap">{c.body}</p>
                    <p className="mt-0.5 text-[10px] text-bark">{c.author ? `${c.author} · ` : ""}{ago(c.created_at)} ago</p>
                  </div>
                </div>
              ))}
              <div className="flex items-end gap-1.5 pt-1">
                <div className="relative flex-1">
                  {mentionFor === "reply" && mentionMatches.length > 0 && (
                    <div className="absolute bottom-full mb-1 left-0 right-0 z-10 rounded-lg border border-sand bg-white shadow-sm overflow-hidden">
                      {mentionMatches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => applyMention(reply, m, setReply)}
                          className="w-full text-left px-2.5 py-1.5 text-[11px] text-espresso hover:bg-cream transition-colors"
                        >
                          {nameOf(m)}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={reply}
                    onChange={(e) => { setReply(e.target.value); onMentionInput(e.target.value, "reply"); }}
                    rows={2}
                    placeholder="Reply… (@name to tag)"
                    className={`${input} resize-none w-full`}
                  />
                </div>
                <button type="button" onClick={() => void submitReply()} disabled={!reply.trim()} className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50 shrink-0">Send</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {composingTopic ? (
                <div className="rounded-lg border border-sand bg-cream/40 p-2.5 space-y-1.5">
                  <input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} placeholder="Topic title" className={input} autoFocus />
                  <div className="relative">
                    {mentionFor === "topic" && mentionMatches.length > 0 && (
                      <div className="absolute bottom-full mb-1 left-0 right-0 z-10 rounded-lg border border-sand bg-white shadow-sm overflow-hidden">
                        {mentionMatches.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => applyMention(topicBody, m, setTopicBody)}
                            className="w-full text-left px-2.5 py-1.5 text-[11px] text-espresso hover:bg-cream transition-colors"
                          >
                            {nameOf(m)}
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      value={topicBody}
                      onChange={(e) => { setTopicBody(e.target.value); onMentionInput(e.target.value, "topic"); }}
                      rows={3}
                      placeholder="What is this about? (@name to tag)"
                      className={`${input} resize-none w-full`}
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void createTopic()}
                      disabled={sending || !topicTitle.trim() || !topicBody.trim()}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50"
                    >
                      Post
                    </button>
                    <button type="button" onClick={() => setComposingTopic(false)} className="px-2.5 py-1.5 rounded-lg bg-stone/10 text-stone text-[11px] font-semibold hover:bg-stone/20">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setComposingTopic(true)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50"
                >
                  + New topic
                </button>
              )}

              {/* Stacked, not side by side: the select is as wide as its
                  longest topic title, which in this column left the search box
                  a few pixels wide. */}
              <div className="space-y-1.5">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search topics…"
                  className={`${input} w-full`}
                />
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={`${input} w-full`}>
                  <option value="all">All topics</option>
                  {topicTitles.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {canSeeTrash && <option value="__trash">Trash ({trashed.length})</option>}
                </select>
              </div>

              {projectFilter === "__trash" ? (
                trashed.length === 0 ? (
                  <p className="text-[12px] text-walnut px-1">Nothing in the trash.</p>
                ) : (
                  trashed.map((t) => (
                    <div key={t.id} className="rounded-lg border border-sand bg-parchment/30 px-2.5 py-2">
                      <p className="text-[12px] font-semibold text-espresso truncate">{t.title || "Untitled"}</p>
                      {t.body && <p className="text-[11px] text-walnut line-clamp-2 whitespace-pre-wrap">{t.body}</p>}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-bark truncate">
                          {projectName.get(t.project_id) ?? "Project"} · trashed
                        </span>
                        <button
                          type="button"
                          onClick={() => void restoreThread(t)}
                          disabled={busyThread === t.id}
                          className="shrink-0 px-2 py-0.5 rounded-lg bg-stone/10 text-stone text-[10px] font-semibold hover:bg-stone/20 disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : gLoading ? <p className="text-[12px] text-stone px-1">Loading…</p> : threads.length === 0 ? <p className="text-[12px] text-walnut px-1">No threads yet.</p> : visibleThreads.length === 0 ? <p className="text-[12px] text-walnut px-1">Nothing matches that.</p> : (
                visibleThreads.map((t) => (
                  <button key={t.id} type="button" onClick={() => setActiveThread(t)} className="w-full text-left rounded-lg border border-sand bg-white px-2.5 py-2 hover:bg-cream transition-colors">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-semibold text-espresso truncate">{t.title || "Untitled"}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {/* Who is in this conversation, at a glance. */}
                        <span className="flex -space-x-1">
                          {participantsOf(t).slice(0, 3).map((id) => (
                            <Avatar
                              key={id}
                              member={memberById.get(id)}
                              name={(t.comments ?? []).find((c) => c.author_id === id)?.author}
                              size={16}
                            />
                          ))}
                        </span>
                        {t.comment_count > 0 && <span className="text-[10px] text-stone">{t.comment_count}</span>}
                      </span>
                    </span>
                    {t.body && <span className="block text-[11px] text-walnut truncate">{t.body}</span>}
                    <span className="block text-[10px] text-bark truncate">{projectName.get(t.project_id) ?? "Project"} · {ago(t.created_at)} ago</span>
                  </button>
                ))
              )}
            </div>
          )
        ) : (
          /* ── Personal ── */
          activeConv ? (
            <div className="flex flex-col gap-2 h-full">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setActiveConv(null); void loadConvs(); }} className="text-[10px] font-semibold text-slate-blue hover:underline">← Back</button>
                <span className="text-[12px] font-bold text-espresso truncate">{activeConv.title}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
                {dms.length === 0 && <p className="text-[11px] text-walnut">No messages yet — say hi.</p>}
                {dms.map((m) => (
                  <div key={m.id} className={`flex items-end gap-1.5 ${m.mine ? "flex-row-reverse" : ""}`}>
                    {!m.mine && (
                      <Avatar member={memberById.get(m.sender_id ?? "")} name={m.sender_name} size={20} />
                    )}
                    <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] ${m.mine ? "bg-amber-soft text-espresso border border-amber/20" : "bg-parchment text-espresso"}`}>
                      {activeConv.is_group && !m.mine && <p className="text-[9px] font-semibold opacity-70 mb-0.5">{m.sender_name}</p>}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-0.5 text-[9px] text-bark">{ago(m.created_at)} ago</p>
                    </div>
                  </div>
                ))}
                <div ref={dmEndRef} />
              </div>
              <div className="flex items-end gap-1.5">
                <textarea value={dmText} onChange={(e) => setDmText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendDm(); } }} rows={1} placeholder="Message…" className={`${input} resize-none flex-1`} />
                <button type="button" onClick={() => void sendDm()} disabled={sending || !dmText.trim()} className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50 shrink-0">Send</button>
              </div>
            </div>
          ) : composingChat ? (
            <div className="space-y-2">
              <button type="button" onClick={() => { setComposingChat(false); setPicked(new Set()); }} className="text-[10px] font-semibold text-slate-blue hover:underline">← Back</button>
              <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Pick people</p>
              <div className="space-y-0.5 max-h-40 overflow-y-auto rounded-lg border border-sand p-1.5">
                {team.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 py-0.5 px-1 text-[12px] text-espresso cursor-pointer hover:bg-cream rounded">
                    <input type="checkbox" className="accent-sage" checked={picked.has(m.id)} onChange={(e) => setPicked((prev) => { const s = new Set(prev); if (e.target.checked) s.add(m.id); else s.delete(m.id); return s; })} />
                    {nameOf(m)}
                  </label>
                ))}
              </div>
              {picked.size > 1 && <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name (optional)" className={input} />}
              <button type="button" onClick={() => void startChat()} disabled={sending || picked.size === 0} className="w-full px-3 py-1.5 rounded-lg bg-amber-soft text-amber text-[12px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50">{picked.size > 1 ? "Start group chat" : "Start chat"}</button>
            </div>
          ) : (
            <div className="space-y-2">
              <button type="button" onClick={() => setComposingChat(true)} className="w-full rounded-lg border border-dashed border-sand py-1.5 text-[11px] font-semibold text-walnut hover:bg-cream transition-colors">+ New message</button>
              {convs.length === 0 ? <p className="text-[12px] text-walnut px-1">No conversations yet.</p> : (
                convs.map((c) => (
                  <button key={c.id} type="button" onClick={() => void openConv(c)} className="w-full text-left rounded-lg border border-sand bg-white px-2.5 py-2 hover:bg-cream transition-colors">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="flex -space-x-1 shrink-0">
                          {c.members
                            .filter((m) => m.id !== currentUserId)
                            .slice(0, 3)
                            .map((m) => (
                              <Avatar key={m.id} member={memberById.get(m.id)} name={m.name} size={18} />
                            ))}
                        </span>
                        <span className="text-[12px] font-semibold text-espresso truncate">{c.is_group ? "👥 " : ""}{c.title}</span>
                      </span>
                      {c.unread > 0 && <span className="shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-terracotta text-white text-[9px]">{c.unread}</span>}
                    </span>
                    {c.last_message && <span className="block text-[11px] text-walnut truncate">{c.last_message.mine ? "You: " : ""}{c.last_message.body}</span>}
                    {c.last_message && <span className="block text-[10px] text-bark">{ago(c.last_message.created_at)} ago</span>}
                  </button>
                ))
              )}
            </div>
          )
        )}
      </div>
    </div>
  );

  if (!expanded) return panel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={() => setExpanded(false)}
    >
      <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {panel}
      </div>
    </div>
  );
}
