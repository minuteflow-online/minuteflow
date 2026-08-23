"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Bugs and feature requests in the admin panel.
 *
 * These were only ever visible in the portal, behind a button below the sidebar's
 * tab list — so reports arrived and nobody reviewing from admin could find them.
 * Reads the same /api/bug-reports endpoint the portal uses; that route returns
 * every report to a reviewer and only their own to everyone else.
 */

type ReportType = "bug" | "feature";
type ReportStatus = "submitted" | "testing" | "fixed";

interface BugReport {
  id: number;
  user_id: string;
  username: string;
  full_name: string;
  report_type: ReportType | null;
  title: string;
  description: string;
  report_date: string;
  status: ReportStatus;
  drive_file_ids: string[] | null;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<ReportStatus, string> = {
  submitted: "bg-amber-soft text-amber border-amber-200",
  testing: "bg-slate-blue-soft text-slate-blue border-slate-blue/20",
  fixed: "bg-sage-soft text-sage border-sage/20",
};

const TYPE_STYLES: Record<ReportType, string> = {
  bug: "bg-terracotta-soft text-terracotta border-terracotta/20",
  feature: "bg-plum-soft text-plum border-plum/20",
};

const STATUS_ORDER: ReportStatus[] = ["submitted", "testing", "fixed"];

export default function BugReportsAdminTab({ orgTimezone }: { orgTimezone: string }) {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | ReportType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReportStatus>("submitted");
  const [reporterFilter, setReporterFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<Record<number, boolean>>({});
  // Note drafts are held per report so switching between two open reports never
  // carries one person's half-written note onto another's.
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [savingNote, setSavingNote] = useState<Record<number, boolean>>({});
  const [savedNote, setSavedNote] = useState<Record<number, boolean>>({});

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bug-reports");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load reports");
      setReports(data.reports || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const updateStatus = useCallback(async (id: number, status: ReportStatus) => {
    setUpdating((u) => ({ ...u, [id]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/bug-reports?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Could not update status");
      }
      // Updated in place rather than refetched: a refetch re-applies the status
      // filter, and the row just moved would vanish from under the cursor.
      setReports((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setUpdating((u) => ({ ...u, [id]: false }));
    }
  }, []);

  const saveNote = useCallback(
    async (id: number, note: string) => {
      setSavingNote((s) => ({ ...s, [id]: true }));
      setSavedNote((s) => ({ ...s, [id]: false }));
      setError(null);
      try {
        const res = await fetch(`/api/bug-reports?id=${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // Empty clears the note rather than being ignored, so a note added by
          // mistake can be taken back off the requester's view.
          body: JSON.stringify({ admin_notes: note.trim() || null }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || "Could not save note");
        }
        setReports((rs) =>
          rs.map((r) => (r.id === id ? { ...r, admin_notes: note.trim() || null } : r))
        );
        setSavedNote((s) => ({ ...s, [id]: true }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save note");
      } finally {
        setSavingNote((s) => ({ ...s, [id]: false }));
      }
    },
    []
  );

  const reporters = useMemo(() => {
    const names = new Map<string, string>();
    reports.forEach((r) => names.set(r.user_id, r.full_name || r.username || "Unknown"));
    return Array.from(names.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [reports]);

  // Type and reporter narrow the set first, so the status counts describe the
  // list actually on screen rather than the whole table.
  const scoped = reports.filter(
    (r) =>
      (typeFilter === "all" || (r.report_type || "bug") === typeFilter) &&
      (reporterFilter === "all" || r.user_id === reporterFilter)
  );
  const visible = scoped.filter((r) => statusFilter === "all" || r.status === statusFilter);

  const countFor = (status: "all" | ReportStatus) =>
    status === "all" ? scoped.length : scoped.filter((r) => r.status === status).length;

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: orgTimezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">Bugs &amp; Feature Requests</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | ReportType)}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">All types</option>
            <option value="bug">Bugs</option>
            <option value="feature">Features</option>
          </select>
          <select
            value={reporterFilter}
            onChange={(e) => setReporterFilter(e.target.value)}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">Everyone</option>
            {reporters.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            {(["all", ...STATUS_ORDER] as const).map((value) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={`rounded-lg px-3 py-1 text-[10px] font-semibold capitalize transition-colors ${
                  statusFilter === value
                    ? "bg-sage text-white"
                    : "bg-stone/10 text-stone hover:bg-stone/20"
                }`}
              >
                {value} ({countFor(value)})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {error && (
          <p className="mb-3 rounded-lg border border-terracotta/20 bg-terracotta-soft px-3 py-2 text-[11px] text-terracotta">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-bark">Loading reports...</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-bark">No reports match these filters.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((report) => {
              const type = (report.report_type || "bug") as ReportType;
              const isOpen = expandedId === report.id;
              return (
                <div key={report.id} className="rounded-lg border border-sand bg-white">
                  <button
                    onClick={() => setExpandedId(isOpen ? null : report.id)}
                    className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-cream"
                  >
                    <span
                      className={`rounded-full border px-2 py-[1px] text-[9px] font-semibold capitalize ${TYPE_STYLES[type]}`}
                    >
                      {type}
                    </span>
                    <span className="text-[13px] font-semibold text-espresso">{report.title}</span>
                    <span className="text-[11px] text-bark">
                      {report.full_name || report.username || "Unknown"}
                    </span>
                    <span className="text-[10px] text-stone">{formatWhen(report.created_at)}</span>
                    <span
                      className={`ml-auto rounded-full border px-2 py-[1px] text-[9px] font-semibold capitalize ${STATUS_STYLES[report.status]}`}
                    >
                      {report.status}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-parchment px-3 py-3">
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-espresso">
                        {report.description}
                      </p>

                      {(report.drive_file_ids?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {report.drive_file_ids!.map((fileId) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={fileId}
                              src={`/api/drive-image?id=${fileId}`}
                              alt="Attachment"
                              loading="lazy"
                              className="h-[72px] w-[96px] rounded border border-sand object-cover"
                            />
                          ))}
                        </div>
                      )}

                      {/* Notes are shown to the person who filed the report, in
                          their portal — this is the reply channel, not a private
                          scratchpad. */}
                      <div className="mt-3">
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                          Note to {report.full_name?.split(" ")[0] || "reporter"}
                        </label>
                        <textarea
                          value={noteDrafts[report.id] ?? report.admin_notes ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setNoteDrafts((d) => ({ ...d, [report.id]: value }));
                            setSavedNote((s) => ({ ...s, [report.id]: false }));
                          }}
                          rows={2}
                          placeholder="What's happening with this one?"
                          className="w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => saveNote(report.id, noteDrafts[report.id] ?? report.admin_notes ?? "")}
                            disabled={
                              savingNote[report.id] ||
                              (noteDrafts[report.id] ?? report.admin_notes ?? "") ===
                                (report.admin_notes ?? "")
                            }
                            className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                          >
                            {savingNote[report.id] ? "Saving..." : "Save note"}
                          </button>
                          {savedNote[report.id] && (
                            <span className="text-[10px] text-sage">Saved — visible in their portal</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">
                          Status
                        </span>
                        {STATUS_ORDER.map((status) => (
                          <button
                            key={status}
                            disabled={updating[report.id] || report.status === status}
                            onClick={() => updateStatus(report.id, status)}
                            className={`rounded-lg px-3 py-1 text-[10px] font-semibold capitalize transition-colors disabled:opacity-50 ${
                              report.status === status
                                ? "bg-sage text-white"
                                : "bg-stone/10 text-stone hover:bg-stone/20"
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
