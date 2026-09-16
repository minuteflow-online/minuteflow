"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Notif = {
  id: number;
  content: string;
  read: boolean;
  created_at: string;
  assigned_task_id: number | null;
  sender_id: string | null;
};

/**
 * Which "kind of thing happened" a notification's free-text content is, and
 * who did it — used only to decide what can be collapsed together, never
 * shown itself. `content` has no separate machine-readable action field, so
 * this reads the same phrasings every notifyOne/notifyRecipients call site
 * actually writes (see src/lib/notifyOne.ts, notifyRecipients.ts,
 * notifyMentions.ts and their callers). Anything that doesn't match falls
 * back to "ungroupable" rather than guessing — better to leave a message on
 * its own than to fold two different things together under one label.
 */
const ACTION_PATTERNS: Array<{ bucket: string; re: RegExp; noun: (n: number) => string }> = [
  { bucket: "bug", re: /^(.+?) submitted a bug/, noun: (n) => `${n} bug report${n === 1 ? "" : "s"}` },
  { bucket: "idea", re: /^(.+?) submitted a idea/, noun: (n) => `${n} idea${n === 1 ? "" : "s"}` },
  { bucket: "submission", re: /^(.+?) submitted: /, noun: (n) => `${n} task${n === 1 ? "" : "s"}` },
  { bucket: "comment", re: /^(.+?) commented on /, noun: (n) => `${n} comment${n === 1 ? "" : "s"}` },
  { bucket: "mention", re: /^(.+?) mentioned you in /, noun: (n) => `${n} place${n === 1 ? "" : "s"}` },
  { bucket: "dm", re: /^(.+?) sent you a message/, noun: (n) => `${n} message${n === 1 ? "" : "s"}` },
  {
    bucket: "joborder",
    re: /^(.+?) (?:reopened|declined|accepted|offered you) (?:a |the )?job order/,
    noun: (n) => `${n} job order update${n === 1 ? "" : "s"}`,
  },
];

function classify(content: string): { bucket: string; actor: string; noun: (n: number) => string } | null {
  for (const p of ACTION_PATTERNS) {
    const m = content.match(p.re);
    if (m) return { bucket: p.bucket, actor: m[1], noun: p.noun };
  }
  return null;
}

/** A run of adjacent notifications (already sorted newest-first) that share
 *  the same sender and the same kind of action — collapsed into one line
 *  when there's more than one, so ten submissions from the same VA read as
 *  one summary instead of burying everything else in the list. */
type Group = { key: string; items: Notif[]; summary: string | null };

function groupNotifications(items: Notif[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const info = item.sender_id ? classify(item.content) : null;
    const last = groups[groups.length - 1];
    const lastInfo = last && last.items[0].sender_id ? classify(last.items[0].content) : null;
    if (
      info &&
      last &&
      last.items[0].sender_id === item.sender_id &&
      lastInfo?.bucket === info.bucket
    ) {
      last.items.push(item);
      last.summary = `${info.actor} — ${info.noun(last.items.length)}`;
      continue;
    }
    groups.push({ key: String(item.id), items: [item], summary: null });
  }
  return groups;
}

/** Top-nav bell: shows the current user's in-app notifications (mentions and
 *  DMs from the `messages` table) with an unread count. A notification about
 *  a task/submission is clickable — it marks itself read and takes you
 *  straight there, the way opening an email would. A run of same-person,
 *  same-kind notifications collapses into one summarized, expandable line.
 *  Realtime so a new mention pops without a refresh. */
export default function NotificationBell() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const load = async () => {
        const { data } = await supabase
          .from("messages")
          .select("id, content, read, created_at, assigned_task_id, sender_id")
          .eq("target_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        setItems((data ?? []) as Notif[]);
      };
      await load();
      channel = supabase
        .channel("notif-bell")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `target_user_id=eq.${user.id}` }, () => void load())
        .subscribe();
    })();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = items.filter((i) => !i.read).length;
  const groups = useMemo(() => groupNotifications(items), [items]);

  /** Where clicking a notification should go, or null when it's just text.
   *  A task-linked one goes straight to its thread; a DM has no id of its
   *  own to link to, so it's routed by who sent it — the dashboard resolves
   *  (or starts) that conversation and opens it. */
  const destinationFor = (item: Notif): string | null => {
    if (item.assigned_task_id != null) return `/productivity/submissions?taskId=${item.assigned_task_id}`;
    if (item.sender_id && classify(item.content)?.bucket === "dm") return `/dashboard?dmUserId=${item.sender_id}`;
    return null;
  };

  // Marks one notification read without touching the rest — opening the bell
  // no longer clears everything at once, so a task's unread badge elsewhere
  // (e.g. the Submissions hub) survives until it's actually looked at.
  const markRead = async (id: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    const supabase = createClient();
    await supabase.from("messages").update({ read: true }).eq("id", id);
  };

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    const supabase = createClient();
    await supabase.from("messages").update({ read: true }).eq("target_user_id", userId).eq("read", false);
  };

  const handleClick = (item: Notif) => {
    if (!item.read) void markRead(item.id);
    const dest = destinationFor(item);
    if (dest) {
      setOpen(false);
      router.push(dest);
    }
  };

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (i: Notif, indent = false) => {
    const clickable = destinationFor(i) != null;
    return (
      <div
        key={i.id}
        onClick={() => handleClick(i)}
        className={`border-b border-sand/60 px-3 py-2 text-[12px] ${indent ? "pl-5 bg-parchment/20" : ""} ${i.read ? "text-stone" : "bg-cream/40 text-espresso"} ${clickable ? "cursor-pointer hover:bg-parchment/50" : ""}`}
      >
        <p className="leading-snug">{i.content}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="text-[10px] text-bark">{new Date(i.created_at).toLocaleString()}</p>
          {clickable && (
            <span className="shrink-0 text-[10px] font-semibold text-terracotta">View →</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-amber hover:bg-amber-soft transition-colors cursor-pointer"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-terracotta px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-sand bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-sand px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[10px] font-semibold text-stone transition-colors hover:text-espresso"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-stone">Nothing yet.</p>
            ) : (
              groups.map((g) => {
                if (g.items.length === 1) return renderRow(g.items[0]);
                const isOpen = expanded.has(g.key);
                const anyUnread = g.items.some((i) => !i.read);
                return (
                  <div key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      className={`flex w-full items-center justify-between gap-2 border-b border-sand/60 px-3 py-2 text-left text-[12px] transition-colors hover:bg-parchment/50 ${anyUnread ? "bg-cream/40 text-espresso" : "text-stone"}`}
                    >
                      <span className="leading-snug">{g.summary}</span>
                      <span className="shrink-0 text-[10px] text-bark">{isOpen ? "▲" : `▼ ${g.items.length}`}</span>
                    </button>
                    {isOpen && g.items.map((i) => renderRow(i, true))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
