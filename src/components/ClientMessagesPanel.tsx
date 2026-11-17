"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, ago, splitReplyQuote, asMember } from "@/components/DashboardMessagePanel";

interface VaOption {
  id: string;
  full_name: string;
}

interface ConversationListItem {
  id: string;
  is_group: boolean;
  title: string;
  members: { id: string; name: string; avatar_url?: string | null }[];
  last_message: { body: string; created_at: string; mine: boolean } | null;
  updated_at: string;
}

interface Message {
  id: number;
  body: string;
  created_at: string;
  mine: boolean;
  sender_name: string;
}

export default function ClientMessagesPanel() {
  const [vas, setVas] = useState<VaOption[]>([]);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [openConvoId, setOpenConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [trackMessagingTime, setTrackMessagingTime] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newMessagePicked, setNewMessagePicked] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = await res.json();
    setConversations((data.conversations ?? []) as ConversationListItem[]);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [rosterRes, userResult] = await Promise.all([
          fetch("/api/organization-invites"),
          supabase.auth.getUser(),
        ]);
        await loadConversations();
        const rosterData = await rosterRes.json();
        interface MemberRow {
          status: "invited" | "active";
          va_id: string;
          profiles: { full_name: string } | null;
        }
        const active: VaOption[] = ((rosterData.members ?? []) as MemberRow[])
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.va_id, full_name: m.profiles?.full_name ?? "Unknown" }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        setVas(active);

        const userId = userResult.data.user?.id;
        if (userId) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("organization_id")
            .eq("id", userId)
            .single();
          if (profile?.organization_id) {
            setOrgId(profile.organization_id);
            const { data: org } = await supabase
              .from("organizations")
              .select("track_messaging_time")
              .eq("id", profile.organization_id)
              .single();
            setTrackMessagingTime(Boolean(org?.track_messaging_time));
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadConversations]);

  const openThread = useCallback(async (conversationId: string) => {
    setOpenConvoId(conversationId);
    setLoadingThread(true);
    setMessages([]);
    try {
      const msgRes = await fetch(`/api/conversations/${conversationId}/messages`);
      const msgData = await msgRes.json();
      setMessages(msgData.messages ?? []);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const startConversation = useCallback(async () => {
    if (newMessagePicked.size === 0) return;
    setStarting(true);
    try {
      const memberIds = Array.from(newMessagePicked);
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          memberIds.length > 1
            ? { member_ids: memberIds, is_group: true }
            : { member_ids: memberIds }
        ),
      });
      const data = await res.json();
      if (!res.ok) return;
      setShowNewMessage(false);
      setNewMessagePicked(new Set());
      await loadConversations();
      await openThread(data.conversation_id);
    } finally {
      setStarting(false);
    }
  }, [newMessagePicked, loadConversations, openThread]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || !openConvoId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${openConvoId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (res.ok) {
        setDraft("");
        const msgRes = await fetch(`/api/conversations/${openConvoId}/messages`);
        const msgData = await msgRes.json();
        setMessages(msgData.messages ?? []);
        void loadConversations();
      }
    } finally {
      setSending(false);
    }
  }, [draft, openConvoId, loadConversations]);

  const handleToggleTracking = useCallback(async () => {
    if (!orgId) return;
    const next = !trackMessagingTime;
    setTrackMessagingTime(next);
    const supabase = createClient();
    await supabase.from("organizations").update({ track_messaging_time: next }).eq("id", orgId);
  }, [orgId, trackMessagingTime]);

  const toggleNewMessagePick = (vaId: string) => {
    setNewMessagePicked((prev) => {
      const next = new Set(prev);
      if (next.has(vaId)) next.delete(vaId);
      else next.add(vaId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  const trackingToggle = (
    <button
      type="button"
      onClick={() => void handleToggleTracking()}
      className="flex items-center gap-2 text-[11px] font-semibold text-walnut"
    >
      Track messaging time as billable
      <span
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          trackMessagingTime ? "bg-sage" : "bg-stone/30"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            trackMessagingTime ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );

  if (vas.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Messages</h3>
          {trackingToggle}
        </div>
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="text-xs text-stone">
          Invite a VA from Your Team above to start messaging them here.
        </p>
      </div>
    );
  }

  // ── Thread view ──────────────────────────────────────────────
  if (openConvoId) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpenConvoId(null)}
            className="text-[11px] font-semibold text-walnut hover:text-terracotta"
          >
            ← Back to conversations
          </button>
          {trackingToggle}
        </div>

        <div className="rounded-lg border border-sand bg-cream/40 p-3 min-h-[160px] max-h-[320px] overflow-y-auto space-y-2">
          {loadingThread ? (
            <p className="text-xs text-stone">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-stone">No messages yet — say hello.</p>
          ) : (
            messages.map((m) => {
              const { text } = splitReplyQuote(m.body);
              return (
                <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-1.5 text-[12px] ${
                      m.mine ? "bg-terracotta text-white" : "bg-white border border-sand text-espresso"
                    }`}
                  >
                    {!m.mine && <p className="text-[10px] font-semibold opacity-70">{m.sender_name}</p>}
                    <p className="whitespace-pre-wrap">{text}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSend(); }}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
          <button
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    );
  }

  // ── Conversation list + new-message picker ──────────────────
  // Same card markup as DashboardMessagePanel's Personal tab, just without
  // the unread/archive affordances a client has no use for.
  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Messages</h3>
        {trackingToggle}
      </div>

      {!showNewMessage ? (
        <button
          type="button"
          onClick={() => setShowNewMessage(true)}
          className="w-full rounded-lg border border-dashed border-sand py-1.5 text-[11px] font-semibold text-walnut hover:bg-cream transition-colors"
        >
          + New message
        </button>
      ) : (
        <div className="rounded-lg border border-sand bg-parchment/30 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-walnut">Message who? (pick one or more)</p>
          <div className="space-y-0.5 max-h-40 overflow-y-auto rounded-lg border border-sand p-1.5">
            {vas.map((va) => (
              <label key={va.id} className="flex items-center gap-2 py-0.5 px-1 text-[12px] text-espresso cursor-pointer hover:bg-cream rounded">
                <input
                  type="checkbox"
                  className="accent-sage"
                  checked={newMessagePicked.has(va.id)}
                  onChange={() => toggleNewMessagePick(va.id)}
                />
                {va.full_name}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void startConversation()}
              disabled={starting || newMessagePicked.size === 0}
              className="px-3 py-1.5 rounded-lg bg-amber-soft text-amber text-[12px] font-semibold border border-amber/30 hover:bg-amber/20 disabled:opacity-50"
            >
              {starting ? "Starting..." : newMessagePicked.size > 1 ? "Start group chat" : "Start chat"}
            </button>
            <button
              onClick={() => { setShowNewMessage(false); setNewMessagePicked(new Set()); }}
              className="text-[11px] text-stone hover:text-espresso"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {conversations.length === 0 ? (
          <p className="text-[12px] text-walnut px-1">No conversations yet.</p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void openThread(c.id)}
              className="w-full text-left rounded-lg border border-sand bg-white px-2.5 py-2 hover:bg-cream transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="flex -space-x-1 shrink-0">
                  {c.members.slice(0, 3).map((m) => (
                    <Avatar key={m.id} member={asMember(m.id, m.name, m.avatar_url ?? null)} size={18} />
                  ))}
                </span>
                <span className="text-[12px] font-semibold text-espresso truncate">
                  {c.is_group ? "👥 " : ""}{c.title}
                </span>
              </span>
              {c.last_message && (
                <span className="block text-[11px] text-walnut truncate">
                  {c.last_message.mine ? "You: " : ""}{splitReplyQuote(c.last_message.body).text}
                </span>
              )}
              {c.last_message && (
                <span className="block text-[10px] text-bark">{ago(c.last_message.created_at)} ago</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
