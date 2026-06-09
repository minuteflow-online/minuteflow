"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Types ────────────────────────────────────────────────── */

type EmailType = "invoice" | "paystub" | "broadcast" | "invite";
type DateFilter = "all" | "today" | "week" | "month";
type TypeFilter = "all" | EmailType;

interface UnifiedEmail {
  id: string;
  type: EmailType;
  label: string;
  sublabel?: string;
  recipient: string;
  sent_at: string;
  resend_message_id: string;
}

interface EmailEvent {
  resend_message_id: string;
  event_type: string;
  created_at: string;
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const TYPE_COLORS: Record<EmailType, { bg: string; text: string; label: string }> = {
  invoice:   { bg: "#f0f7ff", text: "#1d4ed8", label: "Invoice" },
  paystub:   { bg: "#f0fdf4", text: "#15803d", label: "Paystub" },
  broadcast: { bg: "#fef9ec", text: "#b45309", label: "Broadcast" },
  invite:    { bg: "#f5f0ff", text: "#7c3aed", label: "Invite" },
};

/* ── Component ───────────────────────────────────────────── */

export default function EmailStatusTab() {
  const [records, setRecords]       = useState<UnifiedEmail[]>([]);
  const [events, setEvents]         = useState<EmailEvent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Filters
  const [search, setSearch]         = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // Selection
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();

    const [invoiceRes, paystubRes, broadcastRes, inviteRes, eventsRes, hiddenRes] = await Promise.all([
      sb
        .from("invoices")
        .select("id, invoice_number, to_email, to_name, sent_at, resend_message_id")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false }),
      sb
        .from("paystub_snapshots")
        .select("id, full_name, email_sent_to, created_at, resend_message_id, pay_period_label")
        .order("created_at", { ascending: false }),
      sb
        .from("broadcasts")
        .select("id, title, created_at, resend_message_id")
        .eq("status", "published")
        .order("created_at", { ascending: false }),
      sb
        .from("invitations")
        .select("id, email, created_at, resend_message_id, employment_type, used_at, expires_at")
        .not("resend_message_id", "is", null)
        .order("created_at", { ascending: false }),
      sb
        .from("email_events")
        .select("resend_message_id, event_type, created_at")
        .order("created_at", { ascending: true }),
      sb
        .from("email_log_hidden")
        .select("type, source_id"),
    ]);

    // Build hidden set
    const hidden = new Set<string>();
    for (const h of (hiddenRes.data ?? []) as { type: string; source_id: string }[]) {
      hidden.add(`${h.type}:${h.source_id}`);
    }

    // Build unified records
    const unified: UnifiedEmail[] = [];

    for (const inv of (invoiceRes.data ?? []) as {
      id: number;
      invoice_number: string;
      to_email: string | null;
      to_name: string | null;
      sent_at: string | null;
      resend_message_id: string | null;
    }[]) {
      if (!inv.sent_at) continue;
      if (hidden.has(`invoice:${inv.id}`)) continue;
      unified.push({
        id: String(inv.id),
        type: "invoice",
        label: inv.invoice_number,
        sublabel: inv.to_name ?? undefined,
        recipient: inv.to_email ?? "—",
        sent_at: inv.sent_at,
        resend_message_id: inv.resend_message_id ?? "",
      });
    }

    for (const ps of (paystubRes.data ?? []) as {
      id: string;
      full_name: string;
      email_sent_to: string | null;
      created_at: string;
      resend_message_id: string | null;
      pay_period_label: string | null;
    }[]) {
      if (hidden.has(`paystub:${ps.id}`)) continue;
      unified.push({
        id: ps.id,
        type: "paystub",
        label: ps.full_name,
        sublabel: ps.pay_period_label ?? undefined,
        recipient: ps.email_sent_to ?? "—",
        sent_at: ps.created_at,
        resend_message_id: ps.resend_message_id ?? "",
      });
    }

    for (const bc of (broadcastRes.data ?? []) as {
      id: string;
      title: string;
      created_at: string;
      resend_message_id: string | null;
    }[]) {
      if (hidden.has(`broadcast:${bc.id}`)) continue;
      unified.push({
        id: bc.id,
        type: "broadcast",
        label: bc.title,
        recipient: "Team",
        sent_at: bc.created_at,
        resend_message_id: bc.resend_message_id ?? "",
      });
    }

    for (const invite of (inviteRes.data ?? []) as {
      id: string;
      email: string;
      created_at: string;
      resend_message_id: string | null;
      employment_type: string | null;
      used_at: string | null;
      expires_at: string;
    }[]) {
      if (hidden.has(`invite:${invite.id}`)) continue;
      const inviteStatus = invite.used_at
        ? "Registered"
        : new Date(invite.expires_at) < new Date()
        ? "Expired"
        : "Pending";
      unified.push({
        id: invite.id,
        type: "invite",
        label: invite.email,
        sublabel: invite.employment_type
          ? `${invite.employment_type.replace("_", " ")} · ${inviteStatus}`
          : inviteStatus,
        recipient: invite.email,
        sent_at: invite.created_at,
        resend_message_id: invite.resend_message_id ?? "",
      });
    }

    // Sort newest first
    unified.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());

    setRecords(unified);
    setEvents((eventsRes.data ?? []) as EmailEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Clear selection whenever filters change
  useEffect(() => {
    setSelected(new Set());
  }, [search, dateFilter, typeFilter]);

  /* ── Filtering ── */
  const filteredRecords = React.useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const weekStart  = todayStart - 6 * 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return records.filter((r) => {
      // Type filter
      if (typeFilter !== "all" && r.type !== typeFilter) return false;

      // Date filter
      const ts = new Date(r.sent_at).getTime();
      if (dateFilter === "today"  && ts < todayStart)  return false;
      if (dateFilter === "week"   && ts < weekStart)   return false;
      if (dateFilter === "month"  && ts < monthStart)  return false;

      // Search filter
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [r.label, r.sublabel ?? "", r.recipient].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [records, search, dateFilter, typeFilter]);

  /* ── Single delete ── */
  const handleDelete = useCallback(async (type: EmailType, id: string) => {
    const key = `${type}:${id}`;
    setDeleting(key);
    const sb = createClient();
    await sb.from("email_log_hidden").upsert({ type, source_id: id });
    setRecords((prev) => prev.filter((r) => !(r.type === type && r.id === id)));
    setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    setDeleting(null);
  }, []);

  /* ── Bulk delete ── */
  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    const sb = createClient();
    const toDelete = Array.from(selected).map((key) => {
      const [type, ...rest] = key.split(":");
      return { type, source_id: rest.join(":") };
    });
    await sb.from("email_log_hidden").upsert(toDelete);
    setRecords((prev) =>
      prev.filter((r) => !selected.has(`${r.type}:${r.id}`))
    );
    setSelected(new Set());
    setBulkDeleting(false);
  }, [selected]);

  /* ── Selection helpers ── */
  const allFilteredKeys = React.useMemo(
    () => filteredRecords.map((r) => `${r.type}:${r.id}`),
    [filteredRecords]
  );

  const allSelected = allFilteredKeys.length > 0 && allFilteredKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && allFilteredKeys.some((k) => selected.has(k));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        allFilteredKeys.forEach((k) => next.delete(k));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        allFilteredKeys.forEach((k) => next.add(k));
        return next;
      });
    }
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /* ── Stats (based on all records, not filtered) ── */
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

  const stats = React.useMemo(() => {
    const total   = records.length;
    const opened  = records.filter((r) => !!eventMap[r.resend_message_id]?.opened_at).length;
    const clicked = records.filter((r) => !!eventMap[r.resend_message_id]?.clicked_at).length;
    return { total, opened, clicked };
  }, [records, eventMap]);

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 0 40px" }}>

      {/* ── Stats bar ── */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Sent",  value: stats.total,  color: "#3d2b1f" },
          { label: "Opened",      value: stats.opened, color: "#15803d" },
          { label: "Clicked",     value: stats.clicked, color: "#1d4ed8" },
          {
            label: "Open Rate",
            value: stats.total > 0 ? `${Math.round((stats.opened / stats.total) * 100)}%` : "—",
            color: "#b45309",
          },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              background: "#fff",
              border: "1px solid #e8e0d4",
              borderRadius: 10,
              padding: "16px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#9e9080", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters + Bulk Action bar ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search by name, email, or subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            padding: "8px 12px",
            border: "1px solid #e8e0d4",
            borderRadius: 8,
            fontSize: 13,
            outline: "none",
            background: "#fff",
            color: "#3d2b1f",
          }}
        />

        {/* Date filter buttons */}
        {(["all", "today", "week", "month"] as DateFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            style={{
              padding: "7px 14px",
              border: `1px solid ${dateFilter === f ? "#c0704e" : "#e8e0d4"}`,
              borderRadius: 8,
              fontSize: 12,
              fontWeight: dateFilter === f ? 700 : 400,
              background: dateFilter === f ? "#fff5f0" : "#fff",
              color: dateFilter === f ? "#c0704e" : "#6b5c4e",
              cursor: "pointer",
            }}
          >
            {f === "all" ? "All Dates" : f === "today" ? "Today" : f === "week" ? "Last 7 Days" : "This Month"}
          </button>
        ))}

        {/* Bulk delete button */}
        {selected.size > 0 && (
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            style={{
              padding: "7px 16px",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: bulkDeleting ? "#e8e0d4" : "#c0704e",
              color: "#fff",
              cursor: bulkDeleting ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {bulkDeleting ? "Deleting…" : `Delete Selected (${selected.size})`}
          </button>
        )}
      </div>

      {/* ── Type filter pills ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {([
          { key: "all" as TypeFilter, label: "All Types" },
          { key: "invoice" as TypeFilter, label: "Invoice" },
          { key: "paystub" as TypeFilter, label: "Paystub" },
          { key: "broadcast" as TypeFilter, label: "Broadcast" },
          { key: "invite" as TypeFilter, label: "Invite" },
        ]).map(({ key, label }) => {
          const isActive = typeFilter === key;
          const color = key === "all" ? "#6b5c4e" : TYPE_COLORS[key as EmailType].text;
          const bgColor = key === "all" ? "#f0ece6" : TYPE_COLORS[key as EmailType].bg;
          return (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              style={{
                padding: "5px 14px",
                borderRadius: 20,
                border: `1px solid ${isActive ? color : "#e8e0d4"}`,
                background: isActive ? bgColor : "#fff",
                color: isActive ? color : "#9e9080",
                fontSize: 12,
                fontWeight: isActive ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div style={{ background: "#fff", border: "1px solid #e8e0d4", borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>Loading…</div>
        ) : filteredRecords.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>
            {records.length === 0 ? "No emails sent yet." : "No emails match your filters."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e8e0d4", background: "#faf8f5" }}>
                {/* Select all checkbox */}
                <th style={{ padding: "10px 16px", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: "#c0704e" }}
                  />
                </th>
                {["Type", "Email", "Recipient", "Sent", "Opened", "Clicked", ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 16px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9e9080",
                      textAlign: "left",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((rec, i) => {
                const evts   = eventMap[rec.resend_message_id] ?? {};
                const tc     = TYPE_COLORS[rec.type];
                const rowKey = `${rec.type}:${rec.id}`;
                const isDeleting  = deleting === rowKey;
                const isSelected  = selected.has(rowKey);
                return (
                  <tr
                    key={rowKey}
                    style={{
                      borderBottom: i < filteredRecords.length - 1 ? "1px solid #f0ece6" : "none",
                      background: isSelected ? "#fff8f5" : i % 2 === 0 ? "#fff" : "#faf8f5",
                      opacity: isDeleting ? 0.4 : 1,
                      transition: "opacity 0.15s, background 0.1s",
                    }}
                  >
                    {/* Row checkbox */}
                    <td style={{ padding: "12px 16px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(rowKey)}
                        style={{ cursor: "pointer", accentColor: "#c0704e" }}
                      />
                    </td>
                    {/* Type */}
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          background: tc.bg,
                          color: tc.text,
                        }}
                      >
                        {tc.label}
                      </span>
                    </td>
                    {/* Label */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#3d2b1f" }}>{rec.label}</div>
                      {rec.sublabel && (
                        <div style={{ fontSize: 11, color: "#9e9080", marginTop: 2 }}>{rec.sublabel}</div>
                      )}
                    </td>
                    {/* Recipient */}
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b5c4e" }}>{rec.recipient}</td>
                    {/* Sent */}
                    <td style={{ padding: "12px 16px", fontSize: 11, color: "#9e9080", whiteSpace: "nowrap" }}>
                      {formatDateTime(rec.sent_at)}
                    </td>
                    {/* Opened */}
                    <td style={{ padding: "12px 16px" }}>
                      {evts.opened_at ? (
                        <div>
                          <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: "#f0fdf4", color: "#15803d" }}>
                            ✓ Opened
                          </span>
                          <div style={{ fontSize: 10, color: "#9e9080", marginTop: 3 }}>
                            {formatDateTime(evts.opened_at)}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "#c0b8b0" }}>—</span>
                      )}
                    </td>
                    {/* Clicked */}
                    <td style={{ padding: "12px 16px" }}>
                      {evts.clicked_at ? (
                        <div>
                          <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: "#f0f7ff", color: "#1d4ed8" }}>
                            ✓ Clicked
                          </span>
                          <div style={{ fontSize: 10, color: "#9e9080", marginTop: 3 }}>
                            {formatDateTime(evts.clicked_at)}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "#c0b8b0" }}>—</span>
                      )}
                    </td>
                    {/* Single delete */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => handleDelete(rec.type, rec.id)}
                        disabled={isDeleting || bulkDeleting}
                        title="Remove from log"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: isDeleting || bulkDeleting ? "not-allowed" : "pointer",
                          color: "#c0b8b0",
                          fontSize: 16,
                          lineHeight: 1,
                          padding: "2px 6px",
                          borderRadius: 4,
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => { if (!isDeleting && !bulkDeleting) (e.currentTarget as HTMLButtonElement).style.color = "#c0704e"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#c0b8b0"; }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#c0b8b0", marginTop: 12, textAlign: "right" }}>
        {filteredRecords.length !== records.length
          ? `${filteredRecords.length} of ${records.length} emails`
          : `${records.length} email${records.length !== 1 ? "s" : ""}`}
        {" "}· Open/click data from Resend webhooks
      </div>
    </div>
  );
}
