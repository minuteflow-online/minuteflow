"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Types ────────────────────────────────────────────────── */

type EmailType = "invoice" | "paystub" | "broadcast";

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

const TYPE_COLORS: Record<EmailType, { bg: string; text: string; label: string }> = {
  invoice:   { bg: "#f0f7ff", text: "#1d4ed8", label: "Invoice" },
  paystub:   { bg: "#f0fdf4", text: "#15803d", label: "Paystub" },
  broadcast: { bg: "#fef9ec", text: "#b45309", label: "Broadcast" },
};

/* ── Component ───────────────────────────────────────────── */

export default function EmailStatusTab() {
  const [records, setRecords] = useState<UnifiedEmail[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();

    const [invoiceRes, paystubRes, broadcastRes, eventsRes, hiddenRes] = await Promise.all([
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

    // Sort newest first
    unified.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());

    setRecords(unified);
    setEvents((eventsRes.data ?? []) as EmailEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Delete a row (hide it from the log)
  const handleDelete = useCallback(async (type: EmailType, id: string) => {
    const key = `${type}:${id}`;
    setDeleting(key);
    const sb = createClient();
    await sb.from("email_log_hidden").upsert({ type, source_id: id });
    setRecords((prev) => prev.filter((r) => !(r.type === type && r.id === id)));
    setDeleting(null);
  }, []);

  // Build event lookup: resend_message_id → { opened_at?, clicked_at? }
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

  // Counts for stats bar
  const stats = React.useMemo(() => {
    const total = records.length;
    const opened = records.filter((r) => !!eventMap[r.resend_message_id]?.opened_at).length;
    const clicked = records.filter((r) => !!eventMap[r.resend_message_id]?.clicked_at).length;
    return { total, opened, clicked };
  }, [records, eventMap]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 0 40px" }}>

      {/* ── Stats bar ── */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Sent", value: stats.total, color: "#3d2b1f" },
          { label: "Opened", value: stats.opened, color: "#15803d" },
          { label: "Clicked", value: stats.clicked, color: "#1d4ed8" },
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

      {/* ── Table ── */}
      <div style={{ background: "#fff", border: "1px solid #e8e0d4", borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>Loading…</div>
        ) : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9e9080", fontSize: 13 }}>
            No emails sent yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e8e0d4", background: "#faf8f5" }}>
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
              {records.map((rec, i) => {
                const evts = eventMap[rec.resend_message_id] ?? {};
                const tc = TYPE_COLORS[rec.type];
                const rowKey = `${rec.type}:${rec.id}`;
                const isDeleting = deleting === rowKey;
                return (
                  <tr
                    key={rowKey}
                    style={{
                      borderBottom: i < records.length - 1 ? "1px solid #f0ece6" : "none",
                      background: i % 2 === 0 ? "#fff" : "#faf8f5",
                      opacity: isDeleting ? 0.4 : 1,
                      transition: "opacity 0.15s",
                    }}
                  >
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
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "#f0fdf4",
                              color: "#15803d",
                            }}
                          >
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
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "#f0f7ff",
                              color: "#1d4ed8",
                            }}
                          >
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
                    {/* Delete */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => handleDelete(rec.type, rec.id)}
                        disabled={isDeleting}
                        title="Remove from log"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: isDeleting ? "not-allowed" : "pointer",
                          color: "#c0b8b0",
                          fontSize: 16,
                          lineHeight: 1,
                          padding: "2px 6px",
                          borderRadius: 4,
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => { if (!isDeleting) (e.currentTarget as HTMLButtonElement).style.color = "#c0704e"; }}
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
        {records.length} email{records.length !== 1 ? "s" : ""} · Open/click data from Resend webhooks
      </div>
    </div>
  );
}
