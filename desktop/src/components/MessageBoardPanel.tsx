// The team's General message board. Card/button/badge classes copied from
// DashboardMessagePanel.tsx's General tab (src/components/
// DashboardMessagePanel.tsx) per AGENTS.md — same "+ New topic" amber button,
// same topic-row card, same avatar circle. Self-contained (fetches and polls
// its own topics), same pattern App.tsx already uses for tasks.
//
// Scoped to general topics only — see lib/messageBoard.ts's file comment for
// what's deliberately not here yet (Personal DMs, notifications, per-project
// boards, attachments, mentions, editing).
import { useCallback, useEffect, useState } from "react";
import { fetchGeneralTopics, postTopic, postReply, type Topic } from "../lib/messageBoard";
import { getInitials, getAvatarColor } from "../lib/avatar";

const TOPICS_POLL_MS = 30000;

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function authorName(author: Topic["author"]): string {
  return author?.full_name || author?.username || "Someone";
}

function AvatarCircle({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        backgroundColor: getAvatarColor(name),
      }}
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 border border-white"
    >
      {getInitials(name)}
    </span>
  );
}

const inputClass = "w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white";

export default function MessageBoardPanel() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const rows = await fetchGeneralTopics();
    setTopics(rows);
    // Keep the open thread's own data fresh (new replies) without losing
    // which topic is open.
    setActiveTopic((prev) => (prev ? (rows.find((t) => t.id === prev.id) ?? prev) : prev));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, TOPICS_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const handlePostTopic = useCallback(async () => {
    if (!title.trim() || !body.trim() || posting) return;
    setPosting(true);
    try {
      const created = await postTopic(title.trim(), body.trim());
      if (created) {
        setTitle("");
        setBody("");
        setComposing(false);
        await load();
      }
    } finally {
      setPosting(false);
    }
  }, [title, body, posting, load]);

  const handleReply = useCallback(async () => {
    if (!activeTopic || !reply.trim() || posting) return;
    setPosting(true);
    try {
      const created = await postReply(activeTopic.id, reply.trim());
      if (created) {
        setReply("");
        await load();
      }
    } finally {
      setPosting(false);
    }
  }, [activeTopic, reply, posting, load]);

  if (activeTopic) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setActiveTopic(null)}
            className="text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer"
          >
            ← Back
          </button>
          <span className="text-[13px] font-bold text-espresso truncate">{activeTopic.title || "Untitled"}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
          <div className="flex items-start gap-2">
            <AvatarCircle name={authorName(activeTopic.author)} size={20} />
            <div className="min-w-0 flex-1 rounded-lg bg-parchment/40 px-2.5 py-2">
              <p className="text-[10px] font-semibold text-walnut">
                {authorName(activeTopic.author)} · {ago(activeTopic.created_at)}
              </p>
              <p className="text-[12px] text-espresso whitespace-pre-wrap mt-0.5">{activeTopic.body}</p>
            </div>
          </div>

          {activeTopic.project_message_comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 pl-4">
              <AvatarCircle name={authorName(c.author)} size={18} />
              <div className="min-w-0 flex-1 rounded-lg bg-cream px-2.5 py-1.5">
                <p className="text-[10px] font-semibold text-walnut">
                  {authorName(c.author)} · {ago(c.created_at)}
                </p>
                <p className="text-[12px] text-espresso whitespace-pre-wrap mt-0.5">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-1.5 mt-3 pt-3 border-t border-sand">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleReply();
              }
            }}
            placeholder="Write a reply…"
            className={inputClass}
          />
          <button
            onClick={() => void handleReply()}
            disabled={posting || !reply.trim()}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Message Board</h3>
        {topics.length > 0 && (
          <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
            {topics.length} topic{topics.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {composing ? (
        <div className="rounded-lg border border-sand bg-cream/40 p-2.5 space-y-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Topic title" className={inputClass} autoFocus />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's on your mind?"
            rows={3}
            className={`${inputClass} resize-none`}
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => void handlePostTopic()}
              disabled={posting || !title.trim() || !body.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Post
            </button>
            <button
              onClick={() => setComposing(false)}
              className="px-2.5 py-1.5 rounded-lg bg-stone/10 text-stone text-[11px] font-semibold hover:bg-stone/20 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setComposing(true)}
          className="w-full px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors cursor-pointer"
        >
          + New Topic
        </button>
      )}

      <div className="space-y-1.5 overflow-y-auto min-h-0">
        {loading ? (
          [1, 2, 3].map((i) => <div key={i} className="animate-pulse h-14 w-full bg-parchment rounded-lg" />)
        ) : topics.length === 0 ? (
          <p className="text-xs text-stone py-3 text-center">No topics yet — start one.</p>
        ) : (
          topics.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTopic(t)}
              className="flex w-full flex-col gap-1 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors text-left cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold text-espresso leading-tight truncate">
                  {t.title || "Untitled"}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <AvatarCircle name={authorName(t.author)} size={16} />
                  {t.project_message_comments.length > 0 && (
                    <span className="text-[10px] text-stone">{t.project_message_comments.length}</span>
                  )}
                </span>
              </div>
              {t.body && <span className="text-[11px] text-stone/80 truncate">{t.body}</span>}
              <span className="text-[10px] text-bark">
                {authorName(t.author)} · {ago(t.created_at)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
