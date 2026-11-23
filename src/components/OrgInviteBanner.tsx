"use client";

import { useCallback, useEffect, useState } from "react";

type PendingInvite = {
  id: string;
  organizationName: string;
  invitedByName: string | null;
  invitedAt: string;
};

/**
 * A client's team invite waiting on this VA (see
 * /api/organization-invites/respond). Nothing is shared with the client
 * until the VA accepts here. Renders nothing when there's no pending invite.
 */
export default function OrgInviteBanner() {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/organization-invites/respond", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { invites?: PendingInvite[] };
      setInvites(data.invites ?? []);
    } catch {
      /* not worth interrupting the dashboard over */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (invite: PendingInvite, action: "accept" | "decline") => {
    setBusyId(invite.id);
    setError(null);
    try {
      const res = await fetch("/api/organization-invites/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: invite.id, action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      setNotice(
        action === "accept"
          ? `You joined ${invite.organizationName}. Their tasks will show up in your assigned tasks.`
          : `You declined ${invite.organizationName}'s invite.`
      );
    } finally {
      setBusyId(null);
    }
  };

  if (invites.length === 0 && !notice) return null;

  return (
    <div className="mb-4 rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Team Invites</h3>
        {notice && invites.length === 0 && (
          <button
            onClick={() => setNotice(null)}
            className="text-[10px] font-semibold text-stone hover:text-espresso transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>

      {notice && <p className="text-[11px] text-sage">{notice}</p>}
      {error && <p className="text-[11px] text-terracotta">{error}</p>}

      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-espresso leading-tight">
              {invite.organizationName} invited you to their team
            </span>
            <span className="shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200">
              Pending
            </span>
          </div>
          <div className="text-[11px] text-stone/80">
            {invite.invitedByName ? `From ${invite.invitedByName}. ` : ""}
            If you accept, they can assign you tasks and see your status, time and screenshots
            while you work on their tasks. They never see your work for other accounts.
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => respond(invite, "accept")}
              disabled={busyId === invite.id}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => respond(invite, "decline")}
              disabled={busyId === invite.id}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
