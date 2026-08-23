"use client";

import { useState } from "react";

/**
 * Turns the inbound webhook on or off.
 *
 * A button rather than a curl command because registering it needs the bot
 * token, which is Sensitive in Vercel and unreadable by anyone — including
 * whoever is doing the setup.
 */
export default function TelegramWebhookButton({ active }: { active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const call = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/telegram/set-webhook", { method });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setResult(method === "POST" ? "Webhook registered. Reload to confirm." : "Webhook removed.");
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Inbound webhook</h3>
        <span className="text-[11px] text-stone/80">{active ? "registered" : "not registered"}</span>
      </div>
      <p className="text-[11px] text-stone/80">
        Lets the bot receive /start, which is how someone gets connected for private messages.
        Registering it stops the chat list above updating — Telegram delivers each update once,
        either to the webhook or to that listing, never both.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => call("POST")}
          disabled={busy}
          className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Working…" : active ? "Re-register" : "Register webhook"}
        </button>
        {active && (
          <button
            onClick={() => call("DELETE")}
            disabled={busy}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {result && <p className="text-[11px] text-walnut">{result}</p>}
    </div>
  );
}
