"use client";

// Admin oversight of Personal messages — the DMs and group chats people send
// each other from DashboardMessagePanel's "Personal" tab. Read-only by
// design: an admin can open a conversation to review it, but never posts
// into it. Nothing here is auto-surfaced — someone has to click in, per how
// this was asked for.
//
// Gated server-side (see /api/admin/conversations) to the moderation tier
// (Admin, Manager, CEO/Founder) — the same tier that already moderates
// Requests/Feedback/Reviews elsewhere in this panel.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getInitials, getAvatarColor } from "@/lib/utils";
import { AttachmentList, type Attachment } from "@/components/AttachmentComposer";

type ConvListItem = {
  id: string;
  is_group: boolean;
  title: string;
  members: { id: string; name: string }[];
  message_count: number;
  last_message: { body: string; created_at: string } | null;
  updated_at: string;
};

type Member = { id: string; name: string; avatar_url: string | null };
type Msg = { id: number; body: string; created_at: string; edited_at?: string | null; sender_id: string; sender_name: string; attachments?: Attachment[] };
type ConvDetail = { conversation: { id: string; is_group: boolean; title: string | null; members: Member[] }; messages: Msg[] };

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Avatar({ member, size = 20 }: { member?: Member; size?: number }) {
  const label = member?.name || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (member?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.avatar_url} alt={label} title={label} style={style} className="rounded-full object-cover shrink-0 border border-white" />;
  }
  return (
    <span title={label} style={{ ...style, backgroundColor: getAvatarColor(label) }} className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 border border-white">
      {getInitials(label)}
    </span>
  );
}

export default function AdminConversationsTab() {
  const [conversations, setConversations] = useState<ConvListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ConvListItem | null>(null);
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/conversations", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      setConversations((d.conversations ?? []) as ConvListItem[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openConversation = useCallback(async (c: ConvListItem) => {
    setActive(c);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await fetch(`/api/admin/conversations/${c.id}/messages`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      if (d.conversation) setDetail(d as ConvDetail);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.members.some((m) => m.name.toLowerCase().includes(q)) ||
        (c.last_message?.body ?? "").toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const memberById = useMemo(() => new Map((detail?.conversation.members ?? []).map((m) => [m.id, m])), [detail]);

  const input = "w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-600">
        Private conversations between team members. Visible to moderators only — opening one here
        does not mark it read for the people in it, and nothing is posted on your behalf.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* ── Conversation list ── */}
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Conversations</h3>
            <span className="text-[10px] text-stone">{conversations.length}</span>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people or messages…" className={input} />
          <div className="space-y-1.5 max-h-[560px] overflow-y-auto">
            {loading ? (
              <p className="text-[12px] text-stone px-1">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-[12px] text-walnut px-1">{conversations.length === 0 ? "No conversations yet." : "Nothing matches that."}</p>
            ) : (
              visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void openConversation(c)}
                  className={`w-full text-left flex flex-col gap-1 py-2.5 px-3 rounded-lg border transition-colors ${
                    active?.id === c.id ? "border-slate-blue bg-slate-blue-soft/40" : "border-sand bg-white hover:bg-cream"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {c.is_group && <span className="shrink-0 text-[11px]">👥</span>}
                      <span className="text-[13px] font-semibold text-espresso leading-tight truncate">{c.title}</span>
                    </span>
                    <span className="text-[10px] text-stone shrink-0">{c.message_count}</span>
                  </div>
                  {c.last_message && <span className="block text-[11px] text-stone/80 truncate">{c.last_message.body}</span>}
                  <span className="block text-[10px] text-bark">{c.last_message ? `${ago(c.last_message.created_at)} ago` : "no messages"}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3 min-h-[300px]">
          {!active ? (
            <div className="h-full flex items-center justify-center py-16">
              <p className="text-[12px] text-walnut">Pick a conversation to review it.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-sand">
                <div className="flex items-center gap-1.5 min-w-0">
                  {active.is_group && <span className="shrink-0 text-[12px]">👥</span>}
                  <h3 className="text-xs font-bold text-espresso uppercase tracking-wide truncate">{active.title}</h3>
                </div>
                <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-slate-blue-soft text-slate-blue border border-slate-blue/20 shrink-0">
                  {active.members.length} {active.members.length === 1 ? "person" : "people"}
                </span>
              </div>
              {detailLoading ? (
                <p className="text-[12px] text-stone px-1">Loading…</p>
              ) : !detail || detail.messages.length === 0 ? (
                <p className="text-[12px] text-walnut px-1">No messages yet.</p>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {detail.messages.map((m) => (
                    <div key={m.id} className="flex items-start gap-1.5">
                      <Avatar member={memberById.get(m.sender_id)} size={22} />
                      <div className="flex-1 min-w-0 rounded-lg border border-sand bg-cream/40 px-2.5 py-1.5">
                        <p className="text-[10px] font-semibold text-walnut">{m.sender_name}</p>
                        <p className="text-[11px] text-espresso whitespace-pre-wrap break-words">{m.body}</p>
                        <AttachmentList attachments={m.attachments} />
                        <p className="mt-0.5 text-[10px] text-bark">
                          {ago(m.created_at)} ago
                          {m.edited_at && <span className="italic text-stone"> · edited</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
