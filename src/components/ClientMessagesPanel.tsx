"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface VaOption {
  id: string;
  full_name: string;
}

interface Message {
  id: number;
  body: string;
  created_at: string;
  mine: boolean;
  sender_name: string;
}

// Pseudo-target in the selector for the group thread with every active VA —
// never a real id, so it can't collide with one.
const GENERAL = "__general__";

export default function ClientMessagesPanel() {
  const [vas, setVas] = useState<VaOption[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>(GENERAL);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [trackMessagingTime, setTrackMessagingTime] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [rosterRes, userResult] = await Promise.all([
          fetch("/api/organization-invites"),
          supabase.auth.getUser(),
        ]);
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
  }, []);

  const openConversation = useCallback(async (target: string, vaIds: string[]) => {
    setLoadingThread(true);
    setMessages([]);
    try {
      let convoId: string | null = null;

      // Groups have no server-side reuse (only 1:1s do) — check for an
      // existing one first so clicking "General" repeatedly doesn't spawn a
      // fresh thread every time.
      if (target === GENERAL) {
        const listRes = await fetch("/api/conversations");
        const listData = await listRes.json();
        interface ConvoListItem { id: string; is_group: boolean }
        const existing = ((listData.conversations ?? []) as ConvoListItem[]).find((c) => c.is_group);
        if (existing) convoId = existing.id;
      }

      if (!convoId) {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            target === GENERAL
              ? { member_ids: vaIds, is_group: true, title: "Team" }
              : { member_ids: [target] }
          ),
        });
        const data = await res.json();
        if (!res.ok) return;
        convoId = data.conversation_id;
      }

      setConversationId(convoId);
      const msgRes = await fetch(`/api/conversations/${convoId}/messages`);
      const msgData = await msgRes.json();
      setMessages(msgData.messages ?? []);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (vas.length === 0) return;
    void openConversation(selectedTarget, vas.map((v) => v.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTarget, vas.length]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || !conversationId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (res.ok) {
        setDraft("");
        const msgRes = await fetch(`/api/conversations/${conversationId}/messages`);
        const msgData = await msgRes.json();
        setMessages(msgData.messages ?? []);
      }
    } finally {
      setSending(false);
    }
  }, [draft, conversationId]);

  const handleToggleTracking = useCallback(async () => {
    if (!orgId) return;
    const next = !trackMessagingTime;
    setTrackMessagingTime(next);
    const supabase = createClient();
    await supabase.from("organizations").update({ track_messaging_time: next }).eq("id", orgId);
  }, [orgId, trackMessagingTime]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (vas.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="mt-1 text-xs text-stone">
          Invite a VA from Your Team above to start messaging them here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Messages</h3>
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
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selectedTarget}
          onChange={(e) => setSelectedTarget(e.target.value)}
          className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
        >
          <option value={GENERAL}>📢 General (all VAs)</option>
          {vas.map((va) => (
            <option key={va.id} value={va.id}>{va.full_name}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-sand bg-cream/40 p-3 min-h-[160px] max-h-[320px] overflow-y-auto space-y-2">
        {loadingThread ? (
          <p className="text-xs text-stone">Loading...</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-stone">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-1.5 text-[12px] ${
                  m.mine ? "bg-terracotta text-white" : "bg-white border border-sand text-espresso"
                }`}
              >
                {!m.mine && <p className="text-[10px] font-semibold opacity-70">{m.sender_name}</p>}
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            </div>
          ))
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
