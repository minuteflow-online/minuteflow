"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Notif = { id: number; content: string; read: boolean; created_at: string };

/** Top-nav bell: shows the current user's in-app notifications (mentions and
 *  DMs from the `messages` table) with an unread count. Opening it marks all
 *  read. Realtime so a new mention pops without a refresh. */
export default function NotificationBell() {
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
          .select("id, content, read, created_at")
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

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    const supabase = createClient();
    await supabase.from("messages").update({ read: true }).eq("target_user_id", userId).eq("read", false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) void markAllRead(); }}
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
          <div className="border-b border-sand px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-espresso">Notifications</div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-stone">Nothing yet.</p>
            ) : (
              items.map((i) => (
                <div key={i.id} className={`border-b border-sand/60 px-3 py-2 text-[12px] ${i.read ? "text-stone" : "bg-cream/40 text-espresso"}`}>
                  <p className="leading-snug">{i.content}</p>
                  <p className="mt-0.5 text-[10px] text-bark">{new Date(i.created_at).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
