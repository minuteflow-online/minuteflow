// One-off setup helper: lists the Telegram chats the bot can currently see,
// with the id each one needs in Vercel. Exists so nobody has to paste a bot
// token into a terminal to run getUpdates by hand — the token stays in the
// server environment and is never rendered.
//
// Access is gated by (admin)/layout.tsx, same as every other admin page.

export const dynamic = "force-dynamic";

type TgChat = { id: number; title?: string; type: string; first_name?: string };
type TgUpdate = {
  message?: { chat?: TgChat };
  channel_post?: { chat?: TgChat };
  my_chat_member?: { chat?: TgChat };
};

const TARGETS = [
  { env: "TELEGRAM_SUBMISSIONS_CHAT_ID", label: "Submissions, requests, clock-ins, extension" },
  { env: "TELEGRAM_BUGS_CHAT_ID", label: "Bug reports" },
  { env: "TELEGRAM_BUDGET_CHAT_ID", label: "Financial" },
  { env: "TELEGRAM_BOARD_CHAT_ID", label: "Message board" },
];

type Diagnostics = {
  botUsername?: string;
  updateCount?: number;
  webhookUrl?: string;
  privacyHint?: boolean;
};

async function fetchChats(): Promise<{ chats: TgChat[]; error?: string; diag: Diagnostics }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const diag: Diagnostics = {};
  if (!token) return { chats: [], diag, error: "TELEGRAM_BOT_TOKEN is not set in this environment." };

  try {
    // Which bot is this token actually for? Confirms the token is valid and
    // names the bot, which is otherwise unknowable once marked Sensitive.
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store" });
    const meJson = (await meRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!meJson.ok) return { chats: [], diag, error: `Token rejected by Telegram: ${meJson.description ?? "unknown"}` };
    diag.botUsername = meJson.result?.username;

    // A registered webhook makes getUpdates return nothing at all — worth
    // surfacing rather than looking like an empty inbox.
    const hookRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: "no-store" });
    const hookJson = (await hookRes.json()) as { result?: { url?: string } };
    if (hookJson.result?.url) diag.webhookUrl = hookJson.result.url;

    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { cache: "no-store" });
    if (!res.ok) return { chats: [], diag, error: `Telegram returned ${res.status}. ${await res.text()}` };

    const json = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
    if (!json.ok) return { chats: [], diag, error: json.description || "Telegram rejected the request." };

    diag.updateCount = (json.result ?? []).length;

    // One update per message, so the same chat appears many times — dedupe by id.
    const seen = new Map<number, TgChat>();
    for (const u of json.result ?? []) {
      const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (chat && !seen.has(chat.id)) seen.set(chat.id, chat);
    }
    // Zero updates with a valid token is the signature of privacy mode holding
    // ordinary group messages back.
    diag.privacyHint = diag.updateCount === 0;
    return { chats: [...seen.values()], diag };
  } catch (err) {
    return { chats: [], diag, error: String(err) };
  }
}

export default async function TelegramChatsPage() {
  const { chats, error, diag } = await fetchChats();
  // Private chats are listed too: a direct message to one person is a valid
  // destination for any topic, and is the better home for financial alerts.
  // Telegram requires that person to message the bot first, which is what
  // makes their chat id appear here at all.
  const groups = chats;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-espresso">Telegram Chat IDs</h1>
        <p className="text-[11px] text-stone/80">
          Setup helper. Copy each id into the matching variable in Vercel, then redeploy.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-terracotta/20 bg-terracotta-soft px-3 py-2 text-[11px] text-terracotta">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Connection</h3>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
            <span className="text-[13px] font-semibold text-espresso">Bot</span>
            <code className="text-[11px] text-walnut">
              {diag.botUsername ? `@${diag.botUsername}` : "unknown"}
            </code>
          </div>
          <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
            <span className="text-[13px] font-semibold text-espresso">Pending updates</span>
            <code className="text-[11px] text-walnut">{diag.updateCount ?? "—"}</code>
          </div>
          {diag.webhookUrl && (
            <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
              <span className="text-[13px] font-semibold text-espresso">Webhook set</span>
              <code className="text-[11px] text-terracotta truncate max-w-[50%]">{diag.webhookUrl}</code>
            </div>
          )}
        </div>
        {diag.privacyHint && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-600">
            Token works, but Telegram has zero pending updates. That usually means the bot&apos;s
            privacy mode is on, so it cannot see ordinary group messages. In @BotFather send
            /setprivacy, pick this bot, choose Disable, then remove the bot from each group and add
            it back — the setting only applies from the moment it rejoins.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Chats the bot can see</h3>

        {groups.length === 0 ? (
          <p className="text-[11px] text-stone/80">
            No group chats yet. Send /start in the group, then reload. Plain messages stay hidden
            while privacy mode is on.
          </p>
        ) : (
          <div className="space-y-1.5">
            {groups.map((chat) => (
              <div
                key={chat.id}
                className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] font-semibold text-espresso leading-tight truncate">
                    {chat.title || chat.first_name || "Untitled chat"}
                  </span>
                  <span className="text-[11px] text-stone/80">
                    {chat.type === "private" ? "direct message" : chat.type}
                  </span>
                </div>
                <code className="text-[13px] font-semibold text-espresso shrink-0 select-all">{chat.id}</code>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Where each id goes</h3>
        <div className="space-y-1.5">
          {TARGETS.map((t) => (
            <div
              key={t.env}
              className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
            >
              <span className="text-[13px] font-semibold text-espresso">{t.label}</span>
              <code className="text-[11px] text-walnut shrink-0">{t.env}</code>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-stone/80">
          Group ids are negative — include the minus sign. Financial is deliberately separate and
          never falls back to the team group.
        </p>
      </div>
    </div>
  );
}
