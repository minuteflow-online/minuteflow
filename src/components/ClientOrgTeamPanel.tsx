"use client";

import { useCallback, useEffect, useState } from "react";
import { formatWorkDays, shiftHoursFromProfile, workDaysFromProfile } from "@/lib/budget";
import { getInitials, getAvatarColor } from "@/lib/utils";

type OrgAdmin = { id: string; fullName: string; avatarUrl: string | null; orgRole: "owner" | "admin" };
type AdminInvite = { id: string; email: string; created_at: string; expires_at: string };
type OrgVa = {
  id: string;
  status: "invited" | "active";
  orgRole: "va" | "manager";
  joinedAt: string | null;
  invitedAt: string;
  fullName: string;
  avatarUrl: string | null;
  position: string | null;
  department: string | null;
  workDays: number[] | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftHours: number | null;
};
type TeamData = {
  viewerId: string;
  viewerIsOwner: boolean;
  admins: OrgAdmin[];
  pendingAdminInvites: AdminInvite[];
  vas: OrgVa[];
};
type Note = { id: number; body: string; createdAt: string; authorId: string | null; authorName: string };

const BADGE = "shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hhmm(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

function scheduleLine(va: OrgVa): string {
  const days = formatWorkDays(workDaysFromProfile({ work_days: va.workDays }));
  const start = hhmm(va.shiftStart);
  const end = hhmm(va.shiftEnd);
  const hours = shiftHoursFromProfile({ shift_hours: va.shiftHours, shift_start: va.shiftStart, shift_end: va.shiftEnd });
  const span = start && end ? `${start}–${end}` : hours ? `${hours} h/day` : "no set hours";
  return `${days} · ${span}`;
}

function Avatar({ name, url, seed }: { name: string; url: string | null; seed: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: getAvatarColor(seed) }}
    >
      {getInitials(name)}
    </div>
  );
}

/**
 * The client's own Team page: who runs the org (owner + co-admins) and its
 * VAs with work details only, their org role, and the org's private notes.
 */
export default function ClientOrgTeamPanel() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  // VA invites live here now (moved off the dashboard's Your Team card, which
  // is the read-only staff TeamSidebar). New-account invites aren't org
  // members yet, so they come from /api/organization-invites.
  const [vaInviteEmail, setVaInviteEmail] = useState("");
  const [pendingVaInvites, setPendingVaInvites] = useState<{ id: string; email: string }[]>([]);
  const loadVaInvites = useCallback(async () => {
    const res = await fetch("/api/organization-invites", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { pendingInvites?: { id: string; email: string }[] };
      setPendingVaInvites(json.pendingInvites ?? []);
    }
  }, []);
  useEffect(() => {
    void loadVaInvites();
  }, [loadVaInvites]);
  const [openNotesFor, setOpenNotesFor] = useState<string | null>(null);
  // Which removal is waiting for a second click. An on-page confirm rather
  // than window.confirm(), which some browsers and embedded views silently
  // cancel — the button then looks dead.
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/client-admin/team", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as TeamData);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const call = async (key: string, url: string, method: string, body: unknown, okText?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; warning?: string; inviteUrl?: string };
      if (!res.ok) {
        setMessage({ type: "err", text: json.error ?? "Something went wrong." });
        return false;
      }
      if (json.warning) {
        setMessage({ type: "err", text: `${json.warning}${json.inviteUrl ? ` ${json.inviteUrl}` : ""}` });
      } else if (okText || json.message) {
        setMessage({ type: "ok", text: json.message ?? okText ?? "" });
      }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-terracotta">Couldn&apos;t load your team.</p>;
  }

  return (
    <div className="space-y-5">
      {message && (
        <p className={`text-[11px] ${message.type === "ok" ? "text-sage" : "text-terracotta"}`}>{message.text}</p>
      )}

      {/* People who run the org */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Team Admins</h3>
          <span className="text-[11px] text-stone">People from your business who run this team</span>
        </div>

        <div className="space-y-1.5">
          {data.admins.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={a.fullName} url={a.avatarUrl} seed={a.id} />
                <span className="truncate text-[13px] font-semibold text-espresso">
                  {a.fullName}
                  {a.id === data.viewerId && <span className="font-normal text-stone"> (you)</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`${BADGE} ${
                    a.orgRole === "owner"
                      ? "bg-plum-soft text-plum border-plum/20"
                      : "bg-slate-blue-soft text-slate-blue border-slate-blue/20"
                  }`}
                >
                  {a.orgRole === "owner" ? "Owner" : "Co-admin"}
                </span>
                {data.viewerIsOwner && a.orgRole !== "owner" && confirming !== `admin-${a.id}` && (
                  <button
                    disabled={busy === `admin-${a.id}`}
                    onClick={() => setConfirming(`admin-${a.id}`)}
                    className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
              {confirming === `admin-${a.id}` && (
                <ConfirmRow
                  text={`Remove ${a.fullName} as a co-admin? They lose access to this team.`}
                  busy={busy === `admin-${a.id}`}
                  onCancel={() => setConfirming(null)}
                  onConfirm={async () => {
                    await call(`admin-${a.id}`, "/api/client-admin/team/admins", "DELETE", { adminId: a.id }, "Co-admin removed.");
                    setConfirming(null);
                  }}
                />
              )}
            </div>
          ))}

          {data.pendingAdminInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
              <span className="truncate text-[13px] font-semibold text-espresso">{inv.email}</span>
              <div className="flex items-center gap-2">
                <span className={`${BADGE} bg-amber-50 text-amber-500 border-amber-200`}>Invited</span>
                <button
                  disabled={busy === `invite-${inv.id}`}
                  onClick={() => call(`invite-${inv.id}`, "/api/client-admin/team/admins", "DELETE", { inviteId: inv.id }, "Invite cancelled.")}
                  className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!inviteEmail.trim()) return;
            const ok = await call("invite-admin", "/api/client-admin/team/admins", "POST", { email: inviteEmail.trim() });
            if (ok) setInviteEmail("");
          }}
          className="flex items-center gap-2"
        >
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@yourbusiness.com"
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
          <button
            type="submit"
            disabled={busy === "invite-admin" || !inviteEmail.trim()}
            className="shrink-0 px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            Invite co-admin
          </button>
        </form>
        <p className="text-[11px] text-stone/80">
          {data.viewerIsOwner
            ? "Co-admins can do everything you can here. Only you, as owner, can remove one."
            : "Co-admins can do everything the owner can here, except remove another co-admin."}
        </p>
      </div>

      {/* VAs */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">VAs</h3>
          <span className="text-[11px] text-stone">The VAs who work for your team</span>
        </div>

        {data.vas.length === 0 ? (
          <p className="py-6 text-center text-xs text-stone">No VAs on your team yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.vas.map((va) => (
              <div key={va.id} className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={va.fullName} url={va.avatarUrl} seed={va.id} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-espresso leading-tight">{va.fullName}</div>
                      <div className="text-[11px] text-stone/80">
                        {[va.position, va.department].filter(Boolean).join(" · ") || "No position set"}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {va.status === "active" ? (
                      <select
                        value={va.orgRole}
                        disabled={busy === `role-${va.id}`}
                        onChange={(e) =>
                          call(`role-${va.id}`, "/api/client-admin/team", "PATCH", { vaId: va.id, role: e.target.value }, "Role updated.")
                        }
                        className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                        title="Their role in your team only — never their MinuteFlow account"
                      >
                        <option value="va">VA</option>
                        <option value="manager">Manager</option>
                      </select>
                    ) : (
                      <span className={`${BADGE} bg-amber-50 text-amber-500 border-amber-200`} title="Waiting for them to accept">
                        Invited
                      </span>
                    )}
                    {confirming !== `remove-${va.id}` && (
                      <button
                        disabled={busy === `remove-${va.id}`}
                        onClick={() => setConfirming(`remove-${va.id}`)}
                        className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {confirming === `remove-${va.id}` && (
                  <ConfirmRow
                    text={`Take ${va.fullName} off your team? They'll also come off any of your tasks that aren't finished yet, and you'll lose access to their work for you.`}
                    busy={busy === `remove-${va.id}`}
                    onCancel={() => setConfirming(null)}
                    onConfirm={async () => {
                      await call(`remove-${va.id}`, "/api/client-admin/team", "DELETE", { vaId: va.id }, "Removed from your team.");
                      setConfirming(null);
                    }}
                  />
                )}

                <div className="text-[11px] text-stone/80">
                  Schedule: {scheduleLine(va)} ·{" "}
                  {va.status === "active" ? `on your team since ${shortDate(va.joinedAt)}` : `invited ${shortDate(va.invitedAt)}`}
                </div>

                {va.status === "active" && (
                  <div>
                    <button
                      onClick={() => setOpenNotesFor((cur) => (cur === va.id ? null : va.id))}
                      className="text-[11px] font-semibold text-bark hover:text-terracotta transition-colors"
                    >
                      {openNotesFor === va.id ? "Hide notes" : "Notes"}
                    </button>
                    {openNotesFor === va.id && <VaNotes vaId={va.id} viewerId={data.viewerId} viewerIsOwner={data.viewerIsOwner} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {pendingVaInvites.length > 0 && (
          <div className="space-y-1.5">
            {pendingVaInvites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <span className="truncate text-[13px] font-semibold text-espresso leading-tight">{inv.email}</span>
                <span className={`${BADGE} bg-amber-50 text-amber-500 border-amber-200`} title="Waiting for them to sign up">
                  Invited
                </span>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!vaInviteEmail.trim()) return;
            const ok = await call("invite-va", "/api/organization-invites", "POST", { email: vaInviteEmail.trim() });
            if (ok) {
              setVaInviteEmail("");
              await loadVaInvites();
            }
          }}
          className="flex items-center gap-2"
        >
          <input
            type="email"
            value={vaInviteEmail}
            onChange={(e) => setVaInviteEmail(e.target.value)}
            placeholder="VA's email address"
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
          <button
            type="submit"
            disabled={busy === "invite-va" || !vaInviteEmail.trim()}
            className="shrink-0 px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            Invite VA
          </button>
        </form>
        <p className="text-[11px] text-stone/80">
          A Manager is one of your VAs you trust to help run this team; they get your team&apos;s submission alerts.
          Their MinuteFlow account itself doesn&apos;t change.
        </p>
      </div>
    </div>
  );
}

function ConfirmRow({
  text,
  busy,
  onConfirm,
  onCancel,
}: {
  text: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="w-full flex flex-wrap items-center justify-between gap-2 rounded-lg bg-terracotta-soft px-3 py-2">
      <span className="text-[11px] text-terracotta">{text}</span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="px-3 py-1 rounded-lg bg-terracotta text-white text-[11px] font-semibold hover:bg-terracotta/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Removing…" : "Yes, remove"}
        </button>
      </div>
    </div>
  );
}

function VaNotes({ vaId, viewerId, viewerIsOwner }: { vaId: string; viewerId: string; viewerIsOwner: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/client-admin/team/notes?vaId=${encodeURIComponent(vaId)}`, { cache: "no-store" });
    if (res.ok) setNotes(((await res.json()) as { notes: Note[] }).notes ?? []);
  }, [vaId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (method: "POST" | "DELETE", body: unknown) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/client-admin/team/notes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save.");
        return false;
      }
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t border-parchment pt-2">
      <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Private to your team</p>
      {notes.length === 0 && <p className="text-[11px] text-stone">No notes yet.</p>}
      {notes.map((n) => (
        <div key={n.id} className="text-[12px]">
          <div className="flex items-center gap-2 text-[10px] text-bark">
            <span>
              {n.authorName} · {shortDate(n.createdAt)}
            </span>
            {(viewerIsOwner || n.authorId === viewerId) && (
              <button
                disabled={saving}
                onClick={() => send("DELETE", { noteId: n.id })}
                className="font-semibold text-stone hover:text-terracotta disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
          <p className="whitespace-pre-wrap text-espresso">{n.body}</p>
        </div>
      ))}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="Add a note only your team admins can see…"
        className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
      />
      {error && <p className="text-[11px] text-terracotta">{error}</p>}
      <button
        disabled={saving || !draft.trim()}
        onClick={async () => {
          if (await send("POST", { vaId, body: draft })) setDraft("");
        }}
        className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
      >
        Add note
      </button>
    </div>
  );
}
