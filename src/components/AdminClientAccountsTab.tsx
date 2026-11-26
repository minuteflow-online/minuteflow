"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

type OrgRow = {
  id: string;
  name: string;
  ownerName: string;
  createdAt: string;
  coAdmins: number;
  activeVas: number;
  invitedVas: number;
  hoursThisMonthMs: number;
  assignedAdmins: { id: string; name: string }[];
};
type Detail = {
  org: { id: string; name: string; createdAt: string; hoursThisMonthMs: number };
  owner: { id: string; name: string; active: boolean } | null;
  coAdmins: { id: string; name: string; active: boolean }[];
  vas: { id: string; name: string; status: string; orgRole: string; since: string; hoursThisMonthMs: number }[];
  tasks: { id: number; name: string; status: string; dueDate: string | null; archived: boolean; assignees: { name: string; status: string | null }[] }[];
};
type Person = { id: string; name: string };

const BADGE = "text-[10px] font-semibold px-2 py-[2px] rounded-full border";
const STATUS_BADGE: Record<string, string> = {
  pending: "bg-stone/10 text-stone border-stone/20",
  on_queue: "bg-stone/10 text-stone border-stone/20",
  in_progress: "bg-amber-50 text-amber-500 border-amber-200",
  submitted: "bg-sky-50 text-sky-600 border-sky-200",
  reviewing: "bg-violet-50 text-violet-600 border-violet-200",
  revision_needed: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  completed: "bg-sage-soft text-sage border-sage/20",
  paid: "bg-purple-50 text-purple-600 border-purple-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
};

function hours(ms: number): string {
  return ms > 0 ? formatDuration(ms) : "0h";
}

/**
 * Admin → Client Accounts. The agency's view of its MinuteFlow client
 * companies: who runs each one, its VAs and their hours this month (the
 * agency still pays them), and its tasks. Toni sees every client and assigns
 * admins; an assigned admin sees only their clients. Fix-it tools: add one
 * of our VAs to a client's team, or take one off.
 */
export default function AdminClientAccountsTab() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [seesAll, setSeesAll] = useState(false);
  const [assignable, setAssignable] = useState<Person[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const loadList = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/client-orgs", { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          setError(json.error ?? "Couldn't load client accounts.");
          setOrgs([]);
          return;
        }
        setOrgs(json.orgs ?? []);
        setSeesAll(Boolean(json.seesAll));
        setAssignable(json.assignable ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (orgs === null) return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;

  if (openId) {
    return (
      <ClientOrgDetail
        orgId={openId}
        seesAll={seesAll}
        assignable={assignable}
        assigned={orgs.find((o) => o.id === openId)?.assignedAdmins ?? []}
        onBack={() => {
          setOpenId(null);
          void loadList();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">{error}</div>}
      <p className="text-[12px] text-stone">
        {seesAll
          ? "Every client company using MinuteFlow. Assign admins to a client so they can see it too."
          : "The client companies you're assigned to."}
      </p>
      {orgs.length === 0 ? (
        <div className="rounded-xl border border-sand bg-white p-6 text-center text-xs text-stone">
          {seesAll ? "No client accounts yet." : "You're not assigned to any client yet."}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-white p-4 space-y-1.5">
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOpenId(o.id)}
              className="w-full text-left flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold text-espresso leading-tight">{o.name}</span>
                <span className="text-[11px] font-semibold text-walnut">{hours(o.hoursThisMonthMs)} this month</span>
              </div>
              <div className="text-[11px] text-stone/80">
                Owner: {o.ownerName} · {o.coAdmins} co-admin{o.coAdmins === 1 ? "" : "s"} · {o.activeVas} VA{o.activeVas === 1 ? "" : "s"}
                {o.invitedVas > 0 ? ` (+${o.invitedVas} invited)` : ""}
                {" · "}
                {o.assignedAdmins.length > 0 ? `Assigned: ${o.assignedAdmins.map((a) => a.name).join(", ")}` : "No admin assigned"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientOrgDetail({
  orgId,
  seesAll,
  assignable,
  assigned,
  onBack,
}: {
  orgId: string;
  seesAll: boolean;
  assignable: Person[];
  assigned: Person[];
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [agencyVas, setAgencyVas] = useState<Person[]>([]);
  const [addVaId, setAddVaId] = useState("");
  const [adminIds, setAdminIds] = useState<string[]>(assigned.map((a) => a.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [detailKey, setDetailKey] = useState(0);
  const load = useCallback(async () => setDetailKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/client-orgs?id=${orgId}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Detail) : null))
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, detailKey]);

  useEffect(() => {
    fetch("/api/team-members", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setAgencyVas(
          ((d.members ?? []) as Array<{ id: string; full_name: string | null; username: string | null; role?: string }>)
            .filter((m) => !m.role || m.role === "va")
            .map((m) => ({ id: m.id, name: m.full_name || m.username || "Unknown" }))
        )
      )
      .catch(() => {});
  }, []);

  const act = async (key: string, method: string, body: unknown) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/client-orgs", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      setMessage({ ok: res.ok, text: res.ok ? json.message ?? "Saved." : json.error ?? "Something went wrong." });
      if (res.ok) await load();
      return res.ok;
    } finally {
      setBusy(null);
    }
  };

  if (!detail) return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  const onTeam = new Set(detail.vas.map((v) => v.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
        >
          ← All clients
        </button>
        <h3 className="text-sm font-bold text-espresso">{detail.org.name}</h3>
        <span className="text-[11px] text-stone">{hours(detail.org.hoursThisMonthMs)} this month</span>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-2 text-xs ${message.ok ? "border border-sage bg-sage-soft text-sage" : "border border-red-200 bg-red-50 text-red-600"}`}>
          {message.text}
        </div>
      )}

      {/* People who run it */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Client admins</h3>
        <div className="space-y-1.5">
          {detail.owner && (
            <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
              <span className="text-[13px] font-semibold text-espresso">{detail.owner.name}</span>
              <span className={`${BADGE} bg-plum-soft text-plum border-plum/20`}>Owner</span>
            </div>
          )}
          {detail.coAdmins.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white">
              <span className="text-[13px] font-semibold text-espresso">{c.name}</span>
              <span className={`${BADGE} ${c.active ? "bg-slate-blue-soft text-slate-blue border-slate-blue/20" : "bg-stone/10 text-stone border-stone/20"}`}>
                {c.active ? "Co-admin" : "Removed"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* VAs */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">VAs on this client</h3>
          <span className="text-[11px] text-stone">Hours this month</span>
        </div>
        {detail.vas.length === 0 ? (
          <p className="py-4 text-center text-xs text-stone">No VAs on this client yet.</p>
        ) : (
          <div className="space-y-1.5">
            {detail.vas.map((v) => (
              <div key={v.id} className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[13px] font-semibold text-espresso leading-tight">{v.name}</span>
                    <div className="text-[11px] text-stone/80">
                      {v.status === "active" ? `${v.orgRole === "manager" ? "Manager" : "VA"} · since ${v.since.slice(0, 10)}` : "Invited by the client — not accepted yet"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] font-semibold text-walnut">{hours(v.hoursThisMonthMs)}</span>
                    {confirmRemove !== v.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(v.id)}
                        className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {confirmRemove === v.id && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-terracotta-soft/50 px-3 py-2">
                    <span className="text-[11px] text-espresso">
                      Take {v.name} off {detail.org.name}? They also come off its unfinished tasks.
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(null)}
                        className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy === `remove-${v.id}`}
                        onClick={async () => {
                          await act(`remove-${v.id}`, "POST", { action: "remove_va", orgId, vaId: v.id });
                          setConfirmRemove(null);
                        }}
                        className="px-3 py-1 rounded-lg bg-terracotta text-white text-[10px] font-semibold hover:bg-terracotta/90 transition-colors disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <select
            value={addVaId}
            onChange={(e) => setAddVaId(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          >
            <option value="">Add one of our VAs to this client…</option>
            {agencyVas
              .filter((v) => !onTeam.has(v.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!addVaId || busy === "add"}
            onClick={async () => {
              if (await act("add", "POST", { action: "add_va", orgId, vaId: addVaId })) setAddVaId("");
            }}
            className="shrink-0 px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            Add VA
          </button>
        </div>
      </div>

      {/* Assigned admins (Founder only) */}
      {seesAll && (
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Assigned admins</h3>
          <p className="text-[11px] text-stone">Admins assigned here can see this client in Client Accounts. You always see every client.</p>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-sand bg-white p-1.5">
            {assignable.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12px] cursor-pointer hover:bg-cream">
                <input
                  type="checkbox"
                  checked={adminIds.includes(p.id)}
                  onChange={() => setAdminIds((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
                  className="accent-terracotta"
                />
                <span className="truncate text-espresso">{p.name}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy === "assign"}
            onClick={() => act("assign", "PATCH", { orgId, adminIds })}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            Save assigned admins
          </button>
        </div>
      )}

      {/* Tasks */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Tasks</h3>
        {detail.tasks.length === 0 ? (
          <p className="py-4 text-center text-xs text-stone">No tasks yet.</p>
        ) : (
          <div className="space-y-1.5">
            {detail.tasks.map((t) => (
              <div key={t.id} className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-espresso leading-tight">{t.name}</span>
                  <span className={`${BADGE} ${STATUS_BADGE[t.status] ?? "bg-stone/10 text-stone border-stone/20"}`}>
                    {t.archived ? "archived" : t.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="text-[11px] text-stone/80">
                  {t.assignees.length ? t.assignees.map((a) => a.name).join(", ") : "Unassigned"}
                  {t.dueDate ? ` · due ${t.dueDate}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
