"use client";

import React, { useEffect, useState, useCallback } from "react";

/* ── Types ────────────────────────────────────────────────── */

interface Invitation {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  employment_type: string | null;
  requires_extension: boolean;
  resend_message_id: string | null;
  code: string;
}

interface EmailEvent {
  resend_message_id: string;
  event_type: string;
  created_at: string;
}

type StatusFilter = "all" | "pending" | "registered" | "expired";

/* ── Helpers ─────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function getStatus(invite: Invitation): { label: string; color: string; key: StatusFilter } {
  if (invite.used_at) return { label: "Registered", color: "#16a34a", key: "registered" };
  if (new Date(invite.expires_at) < new Date()) return { label: "Expired", color: "#dc2626", key: "expired" };
  return { label: "Pending", color: "#d97706", key: "pending" };
}

/* ── Component ───────────────────────────────────────────── */

export default function VaInvitesAdminTab() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [employmentType, setEmploymentType] = useState<string>("full_time");
  const [requiresExtension, setRequiresExtension] = useState(false);
  const [personalMessage, setPersonalMessage] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invitations");
      if (res.ok) {
        const data = await res.json() as { invitations: Invitation[]; events: EmailEvent[] };
        setInvitations(data.invitations ?? []);
        setEvents(data.events ?? []);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Build event lookup: resend_message_id → { opened_at, clicked_at }
  const eventMap = React.useMemo(() => {
    const map: Record<string, { opened_at?: string; clicked_at?: string }> = {};
    for (const evt of events) {
      if (!map[evt.resend_message_id]) map[evt.resend_message_id] = {};
      if (evt.event_type === "email.opened" && !map[evt.resend_message_id].opened_at) {
        map[evt.resend_message_id].opened_at = evt.created_at;
      }
      if (evt.event_type === "email.clicked" && !map[evt.resend_message_id].clicked_at) {
        map[evt.resend_message_id].clicked_at = evt.created_at;
      }
    }
    return map;
  }, [events]);

  // Filter invitations by status
  const filteredInvitations = React.useMemo(() => {
    if (statusFilter === "all") return invitations;
    return invitations.filter((inv) => getStatus(inv).key === statusFilter);
  }, [invitations, statusFilter]);

  // Status counts for filter badges
  const counts = React.useMemo(() => {
    const c = { all: invitations.length, pending: 0, registered: 0, expired: 0 };
    invitations.forEach((inv) => { c[getStatus(inv).key]++; });
    return c;
  }, [invitations]);

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    setSendSuccess(null);
    setSending(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          employment_type: employmentType,
          requires_extension: requiresExtension,
          message: personalMessage.trim() || null,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; warning?: string; message?: string };
      if (!res.ok || data.error) {
        setSendError(data.error || "Failed to send invite");
      } else {
        setSendSuccess(data.warning ? `⚠️ ${data.warning}` : (data.message || `Invite sent to ${newEmail}`));
        setNewEmail("");
        setPersonalMessage("");
        await load();
      }
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this invitation? The link will stop working immediately.")) return;
    setDeletingId(id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/invitations?id=${id}`, { method: "DELETE" });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) {
        setActionMsg({ id, text: data.error || "Failed to delete", isError: true });
      } else {
        await load();
      }
    } catch {
      setActionMsg({ id, text: "Network error", isError: true });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResend(id: string, email: string) {
    if (!confirm(`Resend invite to ${email}? A fresh link will be generated and the old one will stop working.`)) return;
    setResendingId(id);
    setActionMsg(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "resend" }),
      });
      const data = await res.json() as { success?: boolean; error?: string; warning?: string; message?: string };
      if (!res.ok || data.error) {
        setActionMsg({ id, text: data.error || "Failed to resend", isError: true });
      } else {
        setActionMsg({
          id,
          text: data.warning ? `⚠️ ${data.warning}` : (data.message || `Resent to ${email}`),
          isError: false,
        });
        await load();
      }
    } catch {
      setActionMsg({ id, text: "Network error", isError: true });
    } finally {
      setResendingId(null);
    }
  }

  const filterLabels: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "registered", label: "Registered" },
    { key: "expired", label: "Expired" },
  ];

  const filterColors: Record<StatusFilter, string> = {
    all: "#3d2b1f",
    pending: "#d97706",
    registered: "#16a34a",
    expired: "#dc2626",
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 40px" }}>

      {/* ── Send New Invite ── */}
      <div style={{ background: "#fff", border: "1px solid #e8e0d4", borderRadius: 10, padding: "24px 28px", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#3d2b1f", marginBottom: 16 }}>Send New Invite</div>
        <form onSubmit={handleSendInvite} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9e9080", marginBottom: 4 }}>Email Address</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="va@example.com"
              required
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid #e8e0d4", borderRadius: 6, fontSize: 13, color: "#3d2b1f" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9e9080", marginBottom: 4 }}>Type</label>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              style={{ padding: "8px 12px", border: "1px solid #e8e0d4", borderRadius: 6, fontSize: 13, color: "#3d2b1f", background: "#fff" }}
            >
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
            <input
              type="checkbox"
              id="requires_ext"
              checked={requiresExtension}
              onChange={(e) => setRequiresExtension(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="requires_ext" style={{ fontSize: 13, color: "#3d2b1f", cursor: "pointer" }}>Requires extension</label>
          </div>
          <button
            type="submit"
            disabled={sending}
            style={{
              padding: "8px 20px",
              background: sending ? "#9e9080" : "#c0704e",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: sending ? "not-allowed" : "pointer",
            }}
          >
            {sending ? "Sending…" : "Send Invite"}
          </button>
          <div style={{ flexBasis: "100%", marginTop: 4 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9e9080", marginBottom: 4 }}>Personal Note (optional)</label>
            <textarea
              value={personalMessage}
              onChange={(e) => setPersonalMessage(e.target.value)}
              placeholder="Add a personal message to include in the invite email…"
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid #e8e0d4", borderRadius: 6, fontSize: 13, color: "#3d2b1f", resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
        </form>
        {sendError && <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{sendError}</div>}
        {sendSuccess && <div style={{ marginTop: 10, fontSize: 12, color: "#16a34a" }}>{sendSuccess}</div>}
      </div>

      {/* ── Invite History ── */}
      <div style={{ background: "#fff", border: "1px solid #e8e0d4", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e8e0d4" }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3d2b1f" }}>Invite History</div>
            <button
              onClick={load}
              style={{ fontSize: 11, color: "#9e9080", background: "none", border: "none", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>
          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {filterLabels.map(({ key, label }) => {
              const isActive = statusFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 20,
                    border: `1px solid ${isActive ? filterColors[key] : "#e8e0d4"}`,
                    background: isActive ? filterColors[key] + "18" : "#faf6f0",
                    color: isActive ? filterColors[key] : "#6b5e52",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {label}
                  <span style={{ marginLeft: 5, opacity: 0.7 }}>({counts[key]})</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>Loading…</div>
        ) : filteredInvitations.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>
            {invitations.length === 0 ? "No invites sent yet." : `No ${statusFilter} invites.`}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#faf6f0" }}>
                {["Email", "Sent", "Expires", "Status", "Opened", "Clicked", "Actions"].map((h) => (
                  <th
                    key={h}
                    style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#9e9080", borderBottom: "1px solid #e8e0d4" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredInvitations.map((inv) => {
                const status = getStatus(inv);
                const tracking = inv.resend_message_id ? (eventMap[inv.resend_message_id] ?? {}) : {};
                const isDeleting = deletingId === inv.id;
                const isResending = resendingId === inv.id;
                const msg = actionMsg?.id === inv.id ? actionMsg : null;
                return (
                  <tr key={inv.id} style={{ borderBottom: "1px solid #f0ebe4" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#3d2b1f", fontWeight: 500 }}>
                      {inv.email}
                      {inv.employment_type && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: "#9e9080", background: "#f0ebe4", padding: "2px 6px", borderRadius: 4 }}>
                          {inv.employment_type.replace("_", " ")}
                        </span>
                      )}
                      {inv.requires_extension && (
                        <span style={{ marginLeft: 4, fontSize: 10, color: "#c0704e", background: "#fdf0ea", padding: "2px 6px", borderRadius: 4 }}>
                          ext
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b5e52" }}>{formatDate(inv.created_at)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b5e52" }}>{formatDate(inv.expires_at)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: status.color, background: status.color + "18", padding: "3px 8px", borderRadius: 4 }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {!inv.resend_message_id ? (
                        <span style={{ fontSize: 11, color: "#bbb" }}>—</span>
                      ) : tracking.opened_at ? (
                        <span title={formatDateTime(tracking.opened_at)} style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                          ✓ {formatDate(tracking.opened_at)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9e9080" }}>Not yet</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {!inv.resend_message_id ? (
                        <span style={{ fontSize: 11, color: "#bbb" }}>—</span>
                      ) : tracking.clicked_at ? (
                        <span title={formatDateTime(tracking.clicked_at)} style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                          ✓ {formatDate(tracking.clicked_at)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9e9080" }}>Not yet</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          {/* Resend — only for pending or expired */}
                          {!inv.used_at && (
                            <button
                              onClick={() => handleResend(inv.id, inv.email)}
                              disabled={isResending || isDeleting}
                              style={{
                                padding: "4px 10px",
                                background: isResending ? "#9e9080" : "#c0704e",
                                color: "#fff",
                                border: "none",
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: isResending || isDeleting ? "not-allowed" : "pointer",
                                opacity: isDeleting ? 0.5 : 1,
                              }}
                            >
                              {isResending ? "Sending…" : "Resend"}
                            </button>
                          )}
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(inv.id)}
                            disabled={isDeleting || isResending}
                            style={{
                              padding: "4px 10px",
                              background: "none",
                              color: isDeleting ? "#bbb" : "#dc2626",
                              border: `1px solid ${isDeleting ? "#e8e0d4" : "#fca5a5"}`,
                              borderRadius: 5,
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: isDeleting || isResending ? "not-allowed" : "pointer",
                            }}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        {msg && (
                          <div style={{ fontSize: 11, color: msg.isError ? "#dc2626" : "#16a34a" }}>
                            {msg.text}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
