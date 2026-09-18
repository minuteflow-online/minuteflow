// The team's Messages panel: General board, Personal DMs, Comments feed.
// Card/tab/button classes copied from DashboardMessagePanel.tsx per
// AGENTS.md — same amber tab pills, same "+ New topic"/"+ New message"
// buttons, same conversation/topic row cards, same avatar circles.
//
// Scoped down from the full web feature — see lib/messageBoard.ts,
// lib/conversations.ts, and the desktop README for exactly what's not here
// yet (Admin oversight, per-project boards, attachments, @mention
// autocomplete, editing, group-chat title beyond the basics, delete/pin).
import { useCallback, useEffect, useState } from "react";
import { fetchGeneralTopics, postTopic, postReply, editTopic, editComment, type Topic } from "../lib/messageBoard";
import {
  fetchConversations,
  fetchTeamMembers,
  fetchMessages,
  sendMessage,
  editMessage,
  startConversation,
  type Conversation,
  type DirectMessage,
  type TeamMember,
} from "../lib/conversations";
import { fetchNotifications, type Notification } from "../lib/notifications";
import { getInitials, getAvatarColor } from "../lib/avatar";
import { linkifyText } from "../lib/linkify";
import { AttachmentList, AttachmentPicker, useAttachmentComposer } from "./AttachmentComposer";

const TOPICS_POLL_MS = 30000;
const CONVERSATIONS_POLL_MS = 15000;
const OPEN_CONVERSATION_POLL_MS = 8000;
const NOTIFICATIONS_POLL_MS = 30000;

type InnerTab = "general" | "personal" | "comments";

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function authorName(author: { full_name: string | null; username: string | null } | null): string {
  return author?.full_name || author?.username || "Someone";
}

function memberLabel(m: TeamMember): string {
  return m.full_name || m.username || "?";
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

interface MessageBoardPanelProps {
  userId: string;
  /** Set by the notification bell (App.tsx) when a DM notification is
   *  clicked — opens (or starts) that 1:1 and switches to Personal. `nonce`
   *  changes on every click so re-clicking the same sender still re-triggers
   *  the effect below even though `senderId` itself didn't change. */
  openDmRequest?: { senderId: string; nonce: number } | null;
}

export default function MessageBoardPanel({ userId, openDmRequest }: MessageBoardPanelProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("general");

  // ── General ──────────────────────────────────────────────────────────
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [composingTopic, setComposingTopic] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicBody, setTopicBody] = useState("");
  const [reply, setReply] = useState("");
  const topicComposer = useAttachmentComposer();
  const replyComposer = useAttachmentComposer();
  // Editing your own topic/reply in place — only the words change, with an
  // "edited" mark so nobody is silently rewritten. Mirrors DashboardMessagePanel.tsx.
  const [editingTopic, setEditingTopic] = useState(false);
  const [editTopicTitle, setEditTopicTitle] = useState("");
  const [editTopicBody, setEditTopicBody] = useState("");
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState("");

  // ── Personal ─────────────────────────────────────────────────────────
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [dms, setDms] = useState<DirectMessage[]>([]);
  const [dmText, setDmText] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [composingChat, setComposingChat] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const dmComposer = useAttachmentComposer();
  // Editing one of your own DMs in place — same shape as editing a reply.
  const [editingDm, setEditingDm] = useState<number | null>(null);
  const [editDmText, setEditDmText] = useState("");

  // ── Comments ─────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(true);

  const [posting, setPosting] = useState(false);

  // General: load + poll.
  const loadTopics = useCallback(async () => {
    const rows = await fetchGeneralTopics();
    setTopics(rows);
    setActiveTopic((prev) => (prev ? (rows.find((t) => t.id === prev.id) ?? prev) : prev));
    setTopicsLoading(false);
  }, []);
  useEffect(() => {
    loadTopics();
    const timer = setInterval(loadTopics, TOPICS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadTopics]);

  // Personal: conversations + team list.
  const loadConvs = useCallback(async () => {
    const rows = await fetchConversations();
    setConvs(rows);
    setConvsLoading(false);
  }, []);
  useEffect(() => {
    loadConvs();
  }, [loadConvs]);
  useEffect(() => {
    if (innerTab !== "personal") return;
    const timer = setInterval(loadConvs, CONVERSATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [innerTab, loadConvs]);
  useEffect(() => {
    fetchTeamMembers().then((members) => setTeam(members.filter((m) => m.id !== userId)));
  }, [userId]);
  // Poll the open conversation's messages.
  useEffect(() => {
    if (innerTab !== "personal" || !activeConv) return;
    const timer = setInterval(async () => {
      const rows = await fetchMessages(activeConv.id);
      setDms(rows);
    }, OPEN_CONVERSATION_POLL_MS);
    return () => clearInterval(timer);
  }, [innerTab, activeConv]);

  // Comments: load + poll.
  const loadNotifs = useCallback(async () => {
    const rows = await fetchNotifications(userId);
    setNotifs(rows);
    setNotifsLoading(false);
  }, [userId]);
  useEffect(() => {
    loadNotifs();
    const timer = setInterval(loadNotifs, NOTIFICATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadNotifs]);

  const handlePostTopic = useCallback(async () => {
    const title = topicTitle.trim();
    const body = topicBody.trim() || topicComposer.fallbackBody;
    // A title is still required (matches web), but the body itself can be
    // just an attachment — same "a link/file is content on its own" rule
    // useAttachmentComposer documents.
    if (!title || (!body && !topicComposer.hasAttachment) || posting) return;
    setPosting(true);
    try {
      const created = await postTopic(title, body);
      if (created) {
        setTopicTitle("");
        setTopicBody("");
        setComposingTopic(false);
        if (created.id != null) await topicComposer.flush("project_message", created.id);
        await loadTopics();
      }
    } finally {
      setPosting(false);
    }
  }, [topicTitle, topicBody, topicComposer, posting, loadTopics]);

  const handleReply = useCallback(async () => {
    if (!activeTopic || posting) return;
    const body = reply.trim() || replyComposer.fallbackBody;
    if (!body) return;
    setPosting(true);
    try {
      const created = await postReply(activeTopic.id, body);
      if (created) {
        setReply("");
        if (created.id != null) await replyComposer.flush("project_message_comment", created.id);
        await loadTopics();
      }
    } finally {
      setPosting(false);
    }
  }, [activeTopic, reply, replyComposer, posting, loadTopics]);

  const saveTopicEdit = useCallback(async () => {
    if (!activeTopic) return;
    const title = editTopicTitle.trim();
    const body = editTopicBody.trim();
    if (!title || !body) return;
    const updated = await editTopic(activeTopic.id, title, body);
    if (updated) {
      setEditingTopic(false);
      setActiveTopic((prev) => (prev ? { ...prev, title: updated.title, body: updated.body, edited_at: updated.edited_at } : prev));
      await loadTopics();
    }
  }, [activeTopic, editTopicTitle, editTopicBody, loadTopics]);

  const saveCommentEdit = useCallback(async (topicId: number, commentId: number) => {
    const text = editCommentText.trim();
    if (!text) return;
    const updated = await editComment(topicId, commentId, text);
    if (updated) {
      setEditingComment(null);
      setEditCommentText("");
      await loadTopics();
    }
  }, [editCommentText, loadTopics]);

  const openConv = useCallback(async (c: Conversation) => {
    setActiveConv(c);
    setEditingDm(null);
    const rows = await fetchMessages(c.id);
    setDms(rows);
    void loadConvs();
  }, [loadConvs]);

  // Honors a click on a DM notification (bell dropdown or native toast).
  // startConversation reuses an existing 1:1 rather than making a duplicate
  // — same find-or-create the "+ New message" picker's Start chat uses.
  useEffect(() => {
    if (!openDmRequest) return;
    (async () => {
      const id = await startConversation([openDmRequest.senderId]);
      if (!id) return;
      setInnerTab("personal");
      const rows = await fetchConversations();
      setConvs(rows);
      const conv = rows.find((c) => c.id === id);
      if (conv) await openConv(conv);
    })();
    // openConv is stable (only depends on the also-stable loadConvs), so
    // this only needs to re-run when a new request actually arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDmRequest]);

  const handleSendDm = useCallback(async () => {
    if (!activeConv || posting) return;
    const body = dmText.trim() || dmComposer.fallbackBody;
    if (!body) return;
    setPosting(true);
    try {
      const sent = await sendMessage(activeConv.id, body);
      if (sent) {
        setDms((prev) => [...prev, sent]);
        setDmText("");
        if (sent.id != null) {
          await dmComposer.flush("direct_message", sent.id);
          // Attachments land after the optimistic append above (which has
          // none) — refetch this one conversation so they show without
          // waiting for the poll.
          const refreshed = await fetchMessages(activeConv.id);
          setDms(refreshed);
        }
        void loadConvs();
      }
    } finally {
      setPosting(false);
    }
  }, [activeConv, dmText, dmComposer, posting, loadConvs]);

  const saveDmEdit = useCallback(async (messageId: number) => {
    if (!activeConv) return;
    const text = editDmText.trim();
    if (!text) return;
    const updated = await editMessage(activeConv.id, messageId, text);
    if (updated) {
      setDms((prev) => prev.map((m) => (m.id === messageId ? { ...m, body: updated.body, edited_at: updated.edited_at } : m)));
      setEditingDm(null);
      setEditDmText("");
    }
  }, [activeConv, editDmText]);

  const handleStartChat = useCallback(async () => {
    if (picked.size === 0 || posting) return;
    setPosting(true);
    try {
      const id = await startConversation(Array.from(picked), groupTitle.trim() || undefined);
      if (id) {
        setComposingChat(false);
        setPicked(new Set());
        setGroupTitle("");
        const rows = await fetchConversations();
        setConvs(rows);
        const conv = rows.find((c) => c.id === id);
        if (conv) await openConv(conv);
      }
    } finally {
      setPosting(false);
    }
  }, [picked, groupTitle, posting, openConv]);

  const unreadTotal = convs.reduce((n, c) => n + c.unread, 0);
  const hasNewComments = notifs.some((n) => !n.read);

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 shrink-0">
        {([
          ["general", "General"],
          ["personal", "Personal"],
          ["comments", "Comments"],
        ] as [InnerTab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setInnerTab(k);
              setActiveTopic(null);
              setActiveConv(null);
              setComposingChat(false);
              setEditingTopic(false);
              setEditingComment(null);
              setEditingDm(null);
            }}
            className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
              innerTab === k ? "bg-amber-soft text-amber border border-amber/30" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            {label}
            {k === "personal" && unreadTotal > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-terracotta text-white text-[8px] align-middle">
                {unreadTotal}
              </span>
            )}
            {k === "comments" && hasNewComments && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-terracotta align-middle" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {innerTab === "comments" ? (
          notifsLoading ? (
            <div className="space-y-1.5">
              {[1, 2, 3].map((i) => <div key={i} className="animate-pulse h-12 w-full bg-parchment rounded-lg" />)}
            </div>
          ) : notifs.length === 0 ? (
            <p className="text-xs text-stone py-3 text-center">No notifications yet.</p>
          ) : (
            <div className="space-y-1.5">
              {notifs.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg border px-2.5 py-2 text-[12px] ${
                    n.read ? "border-sand bg-white text-walnut" : "border-terracotta/30 bg-terracotta-soft/30 text-espresso"
                  }`}
                >
                  <p className="leading-snug">{n.content}</p>
                  <p className="mt-0.5 text-[10px] text-bark">{ago(n.created_at)} ago</p>
                </div>
              ))}
            </div>
          )
        ) : innerTab === "general" ? (
          activeTopic ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => {
                    setActiveTopic(null);
                    setEditingTopic(false);
                    setEditingComment(null);
                  }}
                  className="text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer"
                >
                  ← Back
                </button>
                <span className="text-[13px] font-bold text-espresso truncate flex-1">{activeTopic.title || "Untitled"}</span>
                {activeTopic.author_id === userId && !editingTopic && (
                  <button
                    onClick={() => {
                      setEditingTopic(true);
                      setEditTopicTitle(activeTopic.title || "");
                      setEditTopicBody(activeTopic.body || "");
                    }}
                    className="text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer shrink-0"
                  >
                    Edit
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
                <div className="flex items-start gap-2">
                  <AvatarCircle name={authorName(activeTopic.author)} size={20} />
                  <div className="min-w-0 flex-1 rounded-lg bg-parchment/40 px-2.5 py-2">
                    {editingTopic ? (
                      <div className="space-y-1.5">
                        <input value={editTopicTitle} onChange={(e) => setEditTopicTitle(e.target.value)} placeholder="Topic title" className={inputClass} autoFocus />
                        <textarea
                          value={editTopicBody}
                          onChange={(e) => setEditTopicBody(e.target.value)}
                          rows={3}
                          className={`${inputClass} resize-none`}
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => void saveTopicEdit()}
                            disabled={!editTopicTitle.trim() || !editTopicBody.trim()}
                            className="px-2.5 py-1 rounded-lg bg-amber-soft text-amber text-[10px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50 cursor-pointer"
                          >
                            Save
                          </button>
                          <button onClick={() => setEditingTopic(false)} className="px-2.5 py-1 rounded-lg bg-stone/10 text-stone text-[10px] font-semibold hover:bg-stone/20 cursor-pointer">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold text-walnut">
                          {authorName(activeTopic.author)} · {ago(activeTopic.created_at)}
                          {activeTopic.edited_at && <span className="italic text-stone"> · edited</span>}
                        </p>
                        <p className="text-[12px] text-espresso whitespace-pre-wrap mt-0.5">{linkifyText(activeTopic.body)}</p>
                        <AttachmentList attachments={activeTopic.attachments} />
                      </>
                    )}
                  </div>
                </div>

                {activeTopic.project_message_comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 pl-4">
                    <AvatarCircle name={authorName(c.author)} size={18} />
                    <div className="min-w-0 flex-1 rounded-lg bg-cream px-2.5 py-1.5">
                      {editingComment === c.id ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={editCommentText}
                            onChange={(e) => setEditCommentText(e.target.value)}
                            rows={2}
                            autoFocus
                            className={`${inputClass} resize-none`}
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => void saveCommentEdit(activeTopic.id, c.id)}
                              disabled={!editCommentText.trim()}
                              className="px-2.5 py-1 rounded-lg bg-amber-soft text-amber text-[10px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50 cursor-pointer"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingComment(null)} className="px-2.5 py-1 rounded-lg bg-stone/10 text-stone text-[10px] font-semibold hover:bg-stone/20 cursor-pointer">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-[10px] font-semibold text-walnut flex items-center gap-1.5">
                            <span>
                              {authorName(c.author)} · {ago(c.created_at)}
                              {c.edited_at && <span className="italic text-stone"> · edited</span>}
                            </span>
                            {c.author_id === userId && (
                              <button
                                onClick={() => {
                                  setEditingComment(c.id);
                                  setEditCommentText(c.body);
                                }}
                                className="font-semibold text-slate-blue hover:underline cursor-pointer"
                              >
                                Edit
                              </button>
                            )}
                          </p>
                          <p className="text-[12px] text-espresso whitespace-pre-wrap mt-0.5">{linkifyText(c.body)}</p>
                          <AttachmentList attachments={c.attachments} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-sand space-y-1.5">
                <AttachmentPicker composer={replyComposer} disabled={posting} />
                <div className="flex gap-1.5">
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
                    disabled={posting || (!reply.trim() && !replyComposer.hasAttachment)}
                    className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {composingTopic ? (
                <div className="rounded-lg border border-sand bg-cream/40 p-2.5 space-y-1.5">
                  <input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} placeholder="Topic title" className={inputClass} autoFocus />
                  <textarea
                    value={topicBody}
                    onChange={(e) => setTopicBody(e.target.value)}
                    placeholder="What's on your mind?"
                    rows={3}
                    className={`${inputClass} resize-none`}
                  />
                  <AttachmentPicker composer={topicComposer} disabled={posting} />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => void handlePostTopic()}
                      disabled={posting || !topicTitle.trim() || (!topicBody.trim() && !topicComposer.hasAttachment)}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Post
                    </button>
                    <button
                      onClick={() => setComposingTopic(false)}
                      className="px-2.5 py-1.5 rounded-lg bg-stone/10 text-stone text-[11px] font-semibold hover:bg-stone/20 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setComposingTopic(true)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors cursor-pointer"
                >
                  + New Topic
                </button>
              )}

              <div className="space-y-1.5">
                {topicsLoading ? (
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
          )
        ) : (
          /* ── Personal ── */
          activeConv ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => {
                    setActiveConv(null);
                    setEditingDm(null);
                    void loadConvs();
                  }}
                  className="text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer"
                >
                  ← Back
                </button>
                <span className="text-[13px] font-bold text-espresso truncate">{activeConv.title}</span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
                {dms.length === 0 && <p className="text-[11px] text-walnut">No messages yet — say hi.</p>}
                {dms.map((m) => (
                  <div key={m.id} className={`flex items-end gap-1.5 ${m.mine ? "flex-row-reverse" : ""}`}>
                    {!m.mine && <AvatarCircle name={m.sender_name} size={20} />}
                    <div
                      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] ${
                        m.mine ? "bg-amber-soft text-espresso border border-amber/20" : "bg-parchment text-espresso"
                      }`}
                    >
                      {activeConv.is_group && !m.mine && (
                        <p className="text-[9px] font-semibold opacity-70 mb-0.5">{m.sender_name}</p>
                      )}
                      {editingDm === m.id ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={editDmText}
                            onChange={(e) => setEditDmText(e.target.value)}
                            rows={2}
                            autoFocus
                            className="w-full resize-none rounded-lg border border-sand px-2 py-1.5 text-[11px] text-espresso outline-none bg-white"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => void saveDmEdit(m.id)}
                              disabled={!editDmText.trim()}
                              className="px-2.5 py-1 rounded-lg bg-amber-soft text-amber text-[10px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50 cursor-pointer"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingDm(null)} className="px-2.5 py-1 rounded-lg bg-stone/10 text-stone text-[10px] font-semibold hover:bg-stone/20 cursor-pointer">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap">{linkifyText(m.body)}</p>
                          <AttachmentList attachments={m.attachments} />
                          <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-bark">
                            <span>
                              {ago(m.created_at)} ago{m.edited_at && <span className="italic text-stone"> · edited</span>}
                            </span>
                            {m.mine && (
                              <button
                                onClick={() => {
                                  setEditingDm(m.id);
                                  setEditDmText(m.body);
                                }}
                                className="font-semibold text-slate-blue hover:underline cursor-pointer"
                              >
                                Edit
                              </button>
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-sand space-y-1.5">
                <AttachmentPicker composer={dmComposer} disabled={posting} />
                <div className="flex items-end gap-1.5">
                  <textarea
                    value={dmText}
                    onChange={(e) => setDmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendDm();
                      }
                    }}
                    rows={1}
                    placeholder="Message…"
                    className={`${inputClass} resize-none flex-1`}
                  />
                  <button
                    onClick={() => void handleSendDm()}
                    disabled={posting || (!dmText.trim() && !dmComposer.hasAttachment)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          ) : composingChat ? (
            <div className="space-y-2">
              <button
                onClick={() => {
                  setComposingChat(false);
                  setPicked(new Set());
                }}
                className="text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer"
              >
                ← Back
              </button>
              <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Pick people</p>
              <div className="space-y-0.5 max-h-40 overflow-y-auto rounded-lg border border-sand p-1.5">
                {team.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 py-0.5 px-1 text-[12px] text-espresso cursor-pointer hover:bg-cream rounded">
                    <input
                      type="checkbox"
                      className="accent-sage"
                      checked={picked.has(m.id)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(m.id);
                          else next.delete(m.id);
                          return next;
                        })
                      }
                    />
                    {memberLabel(m)}
                  </label>
                ))}
              </div>
              {picked.size > 1 && (
                <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name (optional)" className={inputClass} />
              )}
              <button
                onClick={() => void handleStartChat()}
                disabled={posting || picked.size === 0}
                className="w-full px-3 py-1.5 rounded-lg bg-amber-soft text-amber text-[12px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {picked.size > 1 ? "Start group chat" : "Start chat"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => setComposingChat(true)}
                className="w-full rounded-lg border border-dashed border-sand py-1.5 text-[11px] font-semibold text-walnut hover:bg-cream transition-colors cursor-pointer"
              >
                + New message
              </button>
              {convsLoading ? (
                <div className="space-y-1.5">
                  {[1, 2].map((i) => <div key={i} className="animate-pulse h-14 w-full bg-parchment rounded-lg" />)}
                </div>
              ) : convs.length === 0 ? (
                <p className="text-xs text-stone py-3 text-center">No conversations yet.</p>
              ) : (
                convs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void openConv(c)}
                    className="w-full text-left rounded-lg border border-sand bg-white px-2.5 py-2 hover:bg-cream transition-colors cursor-pointer"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="flex -space-x-1 shrink-0">
                          {c.members.slice(0, 3).map((m) => (
                            <AvatarCircle key={m.id} name={m.name} size={18} />
                          ))}
                        </span>
                        <span className="text-[12px] font-semibold text-espresso truncate">
                          {c.is_group ? "👥 " : ""}
                          {c.title}
                        </span>
                      </span>
                      {c.unread > 0 && (
                        <span className="shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-terracotta text-white text-[9px]">
                          {c.unread}
                        </span>
                      )}
                    </span>
                    {c.last_message && (
                      <span className="block text-[11px] text-walnut truncate">
                        {c.last_message.mine ? "You: " : ""}
                        {c.last_message.body}
                      </span>
                    )}
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
}
