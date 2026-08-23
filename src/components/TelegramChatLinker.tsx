"use client";

import { useState, useEffect, useCallback } from "react";

type Chat = { id: number; title?: string; first_name?: string; type: string };
type Profile = { id: string; full_name: string; username: string; telegram_chat_id: number | null };

/**
 * Matches each person's Telegram chat to their MinuteFlow profile.
 *
 * Telegram only tells us a display name someone chose themselves, which need
 * not resemble their name here — so the match is made by hand rather than
 * guessed. Once linked, the bot can send that person their own notices
 * privately instead of naming them in a group.
 */
export default function TelegramChatLinker({ chats }: { chats: Chat[] }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles/telegram-link");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load profiles");
      setProfiles(json.profiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const link = useCallback(
    async (chatId: number, userId: string) => {
      setSaving(chatId);
      try {
        const res = await fetch("/api/profiles/telegram-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // An empty choice clears whoever held this chat.
          body: JSON.stringify({ user_id: userId, chat_id: userId ? chatId : null }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not save");
        setError(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [load]
  );

  // Only private chats can carry a personal notice — a group would defeat it.
  const direct = chats.filter((c) => c.type === "private");
  const ownerOf = (chatId: number) => profiles.find((p) => p.telegram_chat_id === chatId);
  const unlinked = profiles.filter((p) => !p.telegram_chat_id);

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Private message links</h3>
        <span className="text-[11px] text-stone/80">{direct.length} direct chats</span>
      </div>

      {error && (
        <div className="rounded-lg border border-terracotta/20 bg-terracotta-soft px-3 py-2 text-[11px] text-terracotta">
          {error}
        </div>
      )}

      {direct.length === 0 ? (
        <p className="text-[11px] text-stone/80">
          Nobody has messaged the bot yet. Each person needs to open @minuteflowbot and send /start —
          Telegram will not let a bot message someone first. Reload once they have.
        </p>
      ) : (
        <div className="space-y-1.5">
          {direct.map((chat) => {
            const owner = ownerOf(chat.id);
            return (
              <div
                key={chat.id}
                className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] font-semibold text-espresso leading-tight truncate">
                    {chat.first_name || chat.title || "Unnamed"}
                  </span>
                  <code className="text-[10px] text-stone/80">{chat.id}</code>
                </div>
                <select
                  value={owner?.id ?? ""}
                  disabled={saving === chat.id}
                  onChange={(e) => link(chat.id, e.target.value)}
                  className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white shrink-0 disabled:opacity-50"
                >
                  <option value="">Not linked</option>
                  {owner && (
                    <option value={owner.id}>{owner.full_name || owner.username}</option>
                  )}
                  {profiles
                    .filter((p) => p.id !== owner?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.username}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {unlinked.length > 0 && (
        <p className="text-[10px] text-stone/80">
          No chat yet for: {unlinked.map((p) => p.full_name || p.username).join(", ")}. They will not
          receive private notices until they send /start to the bot.
        </p>
      )}
    </div>
  );
}
