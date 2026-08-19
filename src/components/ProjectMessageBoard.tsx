"use client";

// Message Board tile for an Objective/Operation — posts scoped to one project,
// with threaded comments. Posting/commenting/reading all share one gate
// (canAccessProject, src/lib/projectAccess.ts): the project's assigned VAs,
// its creator, and admins. See docs/operations-basecamp-feature.md Phase 3.

import { useCallback, useEffect, useState } from "react";

type Author = { id: string; full_name: string; username: string; avatar_url: string | null } | null;

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

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Read-only version of AvatarUpload's circle — same photo-or-initials look,
 *  no click-to-upload, since this shows *other* people's avatars in a feed. */
function AuthorAvatar({ author, size = 24 }: { author: Author; size?: number }) {
  const name = authorName(author);
  return author?.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={author.avatar_url}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-terracotta font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {getInitials(name)}
    </div>
  );
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
  // null = list view; a message id = that post's own thread page, full-width,
  // matching Basecamp (click a post, it opens; a back link returns to the list).
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageTitle, setEditMessageTitle] = useState("");
  const [editMessageBody, setEditMessageBody] = useState("");
  const [savingMessageEdit, setSavingMessageEdit] = useState(false);
  const [editMessageError, setEditMessageError] = useState<string | null>(null);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState("");
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);

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
    // The thread this message belongs to no longer exists — back to the list.
    setActiveMessageId((current) => (current === messageId ? null : current));
    try {
      const res = await fetch(`/api/project-messages?id=${messageId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setMessages(previous);
    }
  };

  const startEditMessage = (message: Message) => {
    setEditingMessageId(message.id);
    setEditMessageTitle(message.title);
    setEditMessageBody(message.body);
    setEditMessageError(null);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditMessageError(null);
  };

  const handleSaveMessageEdit = async (messageId: string) => {
    if (!editMessageTitle.trim() || !editMessageBody.trim()) {
      setEditMessageError("Title and message are required.");
      return;
    }
    setSavingMessageEdit(true);
    setEditMessageError(null);
    try {
      const res = await fetch(`/api/project-messages?id=${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editMessageTitle.trim(), body: editMessageBody.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setEditingMessageId(null);
      void fetchMessages();
    } catch (e) {
      setEditMessageError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingMessageEdit(false);
    }
  };

  const startEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditCommentBody(comment.body);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
  };

  const handleSaveCommentEdit = async (messageId: string, commentId: string) => {
    const content = editCommentBody.trim();
    if (!content) return;
    setSavingCommentEdit(true);
    try {
      const res = await fetch(`/api/project-messages/${messageId}/comments?commentId=${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: content }),
      });
      if (!res.ok) throw new Error();
      setEditingCommentId(null);
      void fetchMessages();
    } catch {
      // leave edit mode open so the VA can retry
    } finally {
      setSavingCommentEdit(false);
    }
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

  const activeMessage = activeMessageId ? messages.find((m) => m.id === activeMessageId) ?? null : null;

  // Comment thread — shared between the two views below (a comment can only
  // ever be seen inside the open thread, never from the list).
  const renderComments = (message: Message) => (
    <div className="space-y-1.5 border-t border-sand pt-2">
      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">
        {message.project_message_comments.length === 0
          ? "No comments yet"
          : `${message.project_message_comments.length} comment${message.project_message_comments.length === 1 ? "" : "s"}`}
      </p>
      {message.project_message_comments.map((comment) => {
        const canEditComment = isAdmin || comment.author_id === currentUserId;
        const isEditingComment = editingCommentId === comment.id;
        return (
          <div key={comment.id} className="rounded-lg bg-cream/40 px-2 py-1.5">
            {isEditingComment ? (
              <div className="space-y-1.5">
                <input
                  value={editCommentBody}
                  onChange={(e) => setEditCommentBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveCommentEdit(message.id, comment.id);
                  }}
                  className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveCommentEdit(message.id, comment.id)}
                    disabled={savingCommentEdit}
                    className="text-[10px] font-semibold text-sage hover:text-sage/80 disabled:opacity-50"
                  >
                    {savingCommentEdit ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditComment}
                    className="text-[10px] font-semibold text-stone hover:text-espresso"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-[12px] text-espresso leading-snug">{comment.body}</p>
                  {canEditComment && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditComment(comment)}
                        className="text-[10px] font-semibold text-stone hover:text-espresso"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteComment(message.id, comment.id)}
                        className="text-[10px] font-semibold text-terracotta hover:text-terracotta/80"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <AuthorAvatar author={comment.author} size={16} />
                  <p className="text-[10px] text-stone/80">
                    {authorName(comment.author)} · {formatWhen(comment.created_at)}
                  </p>
                </div>
              </>
            )}
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
  );

  // ── Thread view: one post, opened full — matches Basecamp's "click a
  // message, it opens its own page" pattern. A back link returns to the list.
  if (activeMessage) {
    const canEdit = isAdmin || activeMessage.author_id === currentUserId;
    const isEditingMessage = editingMessageId === activeMessage.id;
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setActiveMessageId(null)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone hover:text-espresso transition-colors cursor-pointer"
        >
          <span aria-hidden="true">←</span> Message Board
        </button>

        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          {isEditingMessage ? (
            <div className="space-y-2">
              <input
                value={editMessageTitle}
                onChange={(e) => setEditMessageTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
              <textarea
                value={editMessageBody}
                onChange={(e) => setEditMessageBody(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
              />
              {editMessageError && <p className="text-[11px] text-terracotta">{editMessageError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveMessageEdit(activeMessage.id)}
                  disabled={savingMessageEdit}
                  className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                >
                  {savingMessageEdit ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditMessage}
                  className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {activeMessage.pinned && (
                    <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200 shrink-0">
                      Pinned
                    </span>
                  )}
                  <h4 className="text-sm font-bold text-espresso leading-tight">{activeMessage.title}</h4>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void handleTogglePin(activeMessage)}
                        className="text-[10px] font-semibold text-stone hover:text-espresso"
                      >
                        {activeMessage.pinned ? "Unpin" : "Pin"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEditMessage(activeMessage)}
                      className="text-[10px] font-semibold text-stone hover:text-espresso"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteMessage(activeMessage.id)}
                      className="text-[10px] font-semibold text-terracotta hover:text-terracotta/80"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-espresso leading-snug">{activeMessage.body}</p>
              <div className="flex items-center gap-1.5">
                <AuthorAvatar author={activeMessage.author} size={22} />
                <p className="text-[10px] text-stone/80">
                  {authorName(activeMessage.author)} · {formatWhen(activeMessage.created_at)}
                </p>
              </div>
            </>
          )}

          {renderComments(activeMessage)}
        </div>
      </div>
    );
  }

  // ── List view: every post as a clickable row, opening its thread on click.
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
            const commentCount = message.project_message_comments.length;
            return (
              <button
                key={message.id}
                type="button"
                onClick={() => setActiveMessageId(message.id)}
                className="flex w-full flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {message.pinned && (
                    <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200 shrink-0">
                      Pinned
                    </span>
                  )}
                  <span className="text-[13px] font-semibold text-espresso leading-tight truncate">{message.title}</span>
                </div>
                <p className="truncate text-[12px] text-stone/80">{message.body}</p>
                <div className="flex items-center gap-1.5">
                  <AuthorAvatar author={message.author} size={18} />
                  <p className="text-[10px] text-stone/80">
                    {authorName(message.author)} · {formatWhen(message.created_at)}
                    {commentCount > 0 && ` · ${commentCount} comment${commentCount === 1 ? "" : "s"}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
