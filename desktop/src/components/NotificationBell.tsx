// The top-bar notification bell — mirrors src/components/NotificationBell.tsx
// exactly for markup/classes (amber bell, badge, dropdown, grouped rows,
// mark-read). The one thing a desktop app can do that a browser tab can't as
// reliably: a native OS toast (+ taskbar flash) for a new item, even while
// the window isn't focused. Self-contained — polls on its own, so it keeps
// working no matter which of the app's tabs is currently showing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  groupNotifications,
  dmSenderFor,
  type BellNotification,
} from "../lib/notificationBell";

const POLL_MS = 20000;

interface NotificationBellProps {
  userId: string;
  /** Fired when a DM notification is clicked — App.tsx switches to the
   *  Message Board's Personal tab and opens/starts that conversation. */
  onOpenDm: (senderId: string) => void;
}

export default function NotificationBell({ userId, onOpenDm }: NotificationBellProps) {
  const [items, setItems] = useState<BellNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  // Which ids have already been accounted for (toast fired or seen at
  // baseline) — a ref, not state, so the poll effect below doesn't need to
  // re-subscribe every time it changes.
  const knownIdsRef = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    const rows = await fetchNotifications(userId);
    setItems(rows);

    if (knownIdsRef.current === null) {
      // First load: this is the baseline, not "new" — nobody wants a toast
      // storm for every unread item from before the app was even open.
      knownIdsRef.current = new Set(rows.map((r) => r.id));
      return;
    }

    const known = knownIdsRef.current;
    const freshUnread = rows.filter((r) => !known.has(r.id) && !r.read);
    for (const r of freshUnread) known.add(r.id);
    for (const r of rows) known.add(r.id); // also track newly-read ones we've now seen

    if (freshUnread.length === 0) return;

    window.mfDesktop.flashFrame();
    if (typeof Notification === "undefined") return;
    const fire = () => {
      for (const r of freshUnread) {
        const notif = new Notification("MinuteFlow", { body: r.content });
        notif.onclick = () => {
          window.focus();
          void markNotificationRead(r.id);
          setItems((prev) => prev.map((i) => (i.id === r.id ? { ...i, read: true } : i)));
          const dm = dmSenderFor(r);
          if (dm) onOpenDm(dm);
        };
      }
    };
    if (Notification.permission === "granted") fire();
    else if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") fire();
      });
    }
  }, [userId, onOpenDm]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = items.filter((i) => !i.read).length;
  const groups = useMemo(() => groupNotifications(items), [items]);

  const markRead = useCallback(async (id: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await markAllNotificationsRead(userId);
  }, [unread, userId]);

  const handleClick = useCallback(
    (item: BellNotification) => {
      if (!item.read) void markRead(item.id);
      const dm = dmSenderFor(item);
      if (dm) {
        setOpen(false);
        onOpenDm(dm);
      }
    },
    [markRead, onOpenDm]
  );

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (i: BellNotification, indent = false) => {
    const clickable = dmSenderFor(i) != null;
    return (
      <div
        key={i.id}
        onClick={() => handleClick(i)}
        className={`border-b border-sand/60 px-3 py-2 text-[12px] ${indent ? "pl-5 bg-parchment/20" : ""} ${
          i.read ? "text-stone" : "bg-cream/40 text-espresso"
        } ${clickable ? "cursor-pointer hover:bg-parchment/50" : ""}`}
      >
        <p className="leading-snug">{i.content}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="text-[10px] text-bark">{new Date(i.created_at).toLocaleString()}</p>
          {clickable && <span className="shrink-0 text-[10px] font-semibold text-terracotta">Open DM →</span>}
        </div>
      </div>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
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
              <button onClick={() => void markAllRead()} className="text-[10px] font-semibold text-stone transition-colors hover:text-espresso cursor-pointer">
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
                      onClick={() => toggleGroup(g.key)}
                      className={`flex w-full items-center justify-between gap-2 border-b border-sand/60 px-3 py-2 text-left text-[12px] transition-colors hover:bg-parchment/50 cursor-pointer ${
                        anyUnread ? "bg-cream/40 text-espresso" : "text-stone"
                      }`}
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
