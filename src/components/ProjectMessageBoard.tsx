"use client";

// Message Board tile for an Objective/Operation — posts scoped to one project,
// with threaded comments. Posting/commenting/reading all share one gate
// (canAccessProject, src/lib/projectAccess.ts): the project's assigned VAs,
// its creator, and admins. See docs/operations-basecamp-feature.md Phase 3.

import { useCallback, useEffect, useState } from "react";

type Author = { id: string; full_name: string; username: string } | null;

interface Comment {
  id: string;
  message_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Author;
}

interface Message {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  body: string;
  category: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  author: Author;
  project_message_comments: Comment[];
}

interface ProjectMessageBoardProps {
  projectId: string;
  currentUserId: string;
  isAdmin: boolean;
}

function authorName(a: Author): string {
  return a?.full_name || a?.username || "Unknown";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ProjectMessageBoard({ projectId, currentUserId, isAdmin }: ProjectMessageBoardProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/project-messages?projectId=${projectId}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setMessages(d.messages ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required.");
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, title: title.trim(), body: body.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setTitle("");
      setBody("");
      setShowCompose(false);
      void fetchMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post.");
    } finally {
      setPosting(false);
    }
  };

  const handleTogglePin = async (message: Message) => {
    const previous = messages;
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, pinned: !m.pinned } : m)));
    try {
      const res = await fetch(`/api/project-messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !message.pinned }),
      });
      if (!res.ok) throw new Error();
      void fetchMessages();
    } catch {
      setMessages(previous);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    const previous = messages;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      const res = await fetch(`/api/project-messages?id=${messageId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setMessages(previous);
    }
  };

  const toggleComments = (messageId: string) => {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const handlePostComment = async (messageId: string) => {
    const draft = (commentDrafts[messageId] ?? "").trim();
    if (!draft) return;
    try {
      const res = await fetch(`/api/project-messages/${messageId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) throw new Error();
      setCommentDrafts((prev) => ({ ...prev, [messageId]: "" }));
      void fetchMessages();
    } catch {
      // leave the draft in place so the VA can retry
    }
  };

  const handleDeleteComment = async (messageId: string, commentId: string) => {
    const previous = messages;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, project_message_comments: m.project_message_comments.filter((c) => c.id !== commentId) }
          : m
      )
    );
    try {
      const res = await fetch(`/api/project-messages/${messageId}/comments?commentId=${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setMessages(previous);
    }
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Message Board</h3>
        <button
          type="button"
          onClick={() => setShowCompose((v) => !v)}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
        >
          {showCompose ? "Cancel" : "+ New Post"}
        </button>
      </div>

      {showCompose && (
        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write an update or announcement…"
            rows={3}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
          />
          {error && <p className="text-[11px] text-terracotta">{error}</p>}
          <button
            type="button"
            onClick={() => void handlePost()}
            disabled={posting}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-[12px] text-stone">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-[12px] text-stone/70">Nothing posted yet.</p>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => {
            const canEdit = isAdmin || message.author_id === currentUserId;
            const commentsOpen = openComments.has(message.id);
            return (
              <div key={message.id} className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {message.pinned && (
                      <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200 shrink-0">
                        Pinned
                      </span>
                    )}
                    <span className="text-[13px] font-semibold text-espresso leading-tight truncate">{message.title}</span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2 shrink-0">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleTogglePin(message)}
                          className="text-[10px] font-semibold text-stone hover:text-espresso"
                        >
                          {message.pinned ? "Unpin" : "Pin"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteMessage(message.id)}
                        className="text-[10px] font-semibold text-terracotta hover:text-terracotta/80"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-[12px] text-espresso leading-snug">{message.body}</p>
                <p className="text-[10px] text-stone/80">
                  {authorName(message.author)} · {formatWhen(message.created_at)}
                </p>

                <button
                  type="button"
                  onClick={() => toggleComments(message.id)}
                  className="mt-1 text-left text-[11px] font-semibold text-terracotta hover:underline w-fit"
                >
                  {message.project_message_comments.length === 0
                    ? "Comment"
                    : `${message.project_message_comments.length} comment${message.project_message_comments.length === 1 ? "" : "s"}`}
                </button>

                {commentsOpen && (
                  <div className="mt-1 space-y-1.5 border-t border-sand pt-2">
                    {message.project_message_comments.map((comment) => {
                      const canDeleteComment = isAdmin || comment.author_id === currentUserId;
                      return (
                        <div key={comment.id} className="rounded-lg bg-cream/40 px-2 py-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="whitespace-pre-wrap text-[12px] text-espresso leading-snug">{comment.body}</p>
                            {canDeleteComment && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteComment(message.id, comment.id)}
                                className="text-[10px] font-semibold text-terracotta hover:text-terracotta/80 shrink-0"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-[10px] text-stone/80">
                            {authorName(comment.author)} · {formatWhen(comment.created_at)}
                          </p>
                        </div>
                      );
                    })}
                    <div className="flex gap-1.5">
                      <input
                        value={commentDrafts[message.id] ?? ""}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [message.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handlePostComment(message.id);
                        }}
                        placeholder="Write a comment…"
                        className="flex-1 rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handlePostComment(message.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
