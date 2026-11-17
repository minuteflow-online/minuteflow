"use client";

import { useCallback, useEffect, useState } from "react";

interface MemberRow {
  id: string;
  status: "invited" | "active";
  va_id: string;
  profiles: { full_name: string } | null;
}

interface PendingInviteRow {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
}

export default function ClientTeamPanel() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/organization-invites");
      const data = await res.json();
      setMembers(data.members ?? []);
      setPendingInvites(data.pendingInvites ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleInvite = useCallback(async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setMessage(null);

    const res = await fetch("/api/organization-invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setMessage({ type: "err", text: data.error || "Failed to send invite." });
      return;
    }

    setMessage({ type: "ok", text: data.message || "Invite sent." });
    setEmail("");
    fetchRoster();
  }, [email, fetchRoster]);

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Your Team
        </h3>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="VA's email address"
          className="flex-1 rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
        />
        <button
          onClick={handleInvite}
          disabled={submitting || !email.trim()}
          className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Invite"}
        </button>
      </div>

      {message && (
        <p className={`text-xs font-medium ${message.type === "ok" ? "text-sage" : "text-terracotta"}`}>
          {message.text}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading...
        </div>
      ) : members.length === 0 && pendingInvites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-espresso">No VAs yet</p>
          <p className="mt-1 text-xs text-stone">
            Invite a VA by email to start monitoring their work here.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
            >
              <span className="text-[13px] font-semibold text-espresso">
                {m.profiles?.full_name ?? "Unknown"}
              </span>
              <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-sage-soft text-sage border border-sage/20">
                Active
              </span>
            </div>
          ))}
          {pendingInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
            >
              <span className="text-[13px] font-semibold text-espresso">{inv.email}</span>
              <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200">
                Invited
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
