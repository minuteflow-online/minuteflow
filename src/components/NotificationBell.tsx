"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Notif = {
  id: number;
  content: string;
  read: boolean;
  created_at: string;
  assigned_task_id: number | null;
};

/** Top-nav bell: shows the current user's in-app notifications (mentions and
 *  DMs from the `messages` table) with an unread count. A notification about
 *  a task/submission is clickable — it marks itself read and takes you
 *  straight there, the way opening an email would. Realtime so a new mention
 *  pops without a refresh. */
export default function NotificationBell() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
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
          .select("id, content, read, created_at, assigned_task_id")
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
    if (item.assigned_task_id != null) {
      setOpen(false);
      router.push(`/productivity/submissions?taskId=${item.assigned_task_id}`);
    }
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
              items.map((i) => {
                const clickable = i.assigned_task_id != null;
                return (
                  <div
                    key={i.id}
                    onClick={() => handleClick(i)}
                    className={`border-b border-sand/60 px-3 py-2 text-[12px] ${i.read ? "text-stone" : "bg-cream/40 text-espresso"} ${clickable ? "cursor-pointer hover:bg-parchment/50" : ""}`}
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
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
