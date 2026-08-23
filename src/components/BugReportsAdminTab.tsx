"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BugReportNotes from "@/components/BugReportNotes";
import BugReportTagEditor from "@/components/BugReportTagEditor";

/**
 * Bugs and feature requests in the admin panel.
 *
 * These were only ever visible in the portal, behind a button below the sidebar's
 * tab list — so reports arrived and nobody reviewing from admin could find them.
 * Reads the same /api/bug-reports endpoint the portal uses; that route returns
 * every report to a reviewer and only their own to everyone else.
 */

type ReportType = "bug" | "feature";
type ReportStatus = "submitted" | "testing" | "fixed" | "dismissed";

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
  tags: string[] | null;
  handled_by_name: string | null;
  archived_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<ReportStatus, string> = {
  submitted: "bg-amber-soft text-amber border-amber-200",
  testing: "bg-slate-blue-soft text-slate-blue border-slate-blue/20",
  fixed: "bg-sage-soft text-sage border-sage/20",
  dismissed: "bg-stone/10 text-stone border-stone/20",
};

const TYPE_STYLES: Record<ReportType, string> = {
  bug: "bg-terracotta-soft text-terracotta border-terracotta/20",
  feature: "bg-plum-soft text-plum border-plum/20",
};

const STATUS_ORDER: ReportStatus[] = ["submitted", "testing", "fixed", "dismissed"];

// Archived is not a status on the record — a fixed report and a dismissed one
// can both be archived — but it is the same question when you are choosing what
// to look at, so it rides in the same dropdown.
type StatusChoice = "all" | ReportStatus | "archived";

// Enough to scan a screen of reports without the list running off the page.
const PAGE_SIZE = 15;

export default function BugReportsAdminTab({
  orgTimezone,
  currentUserId,
}: {
  orgTimezone: string;
  currentUserId?: string;
}) {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | ReportType>("all");
  const [statusFilter, setStatusFilter] = useState<StatusChoice>("submitted");
  const [reporterFilter, setReporterFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<Record<number, boolean>>({});
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState("");

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

  /**
   * Apply one change to every selected report.
   *
   * Sequential rather than parallel: these are a handful of rows at a time, and
   * a burst of parallel PATCHes against the same table buys nothing a person
   * would notice while making a partial failure harder to reason about. The
   * local list is updated per success, so a failure halfway leaves the screen
   * showing exactly what did land.
   */
  const applyToSelected = useCallback(
    async (patch: (report: BugReport) => Record<string, unknown> | null) => {
      setBulkBusy(true);
      setError(null);
      const ids = Array.from(selected);
      for (const id of ids) {
        const report = reports.find((r) => r.id === id);
        if (!report) continue;
        const body = patch(report);
        if (!body) continue;
        try {
          const res = await fetch(`/api/bug-reports?id=${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not update");
          setReports((rs) => rs.map((r) => (r.id === id ? { ...r, ...data.report } : r)));
        } catch (err) {
          setError(
            `${err instanceof Error ? err.message : "Could not update"} — stopped at "${report.title}"`
          );
          break;
        }
      }
      setBulkBusy(false);
      setSelected(new Set());
    },
    [reports, selected]
  );

  const setArchived = useCallback(async (id: number, archived: boolean) => {
    setUpdating((u) => ({ ...u, [id]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/bug-reports?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Could not archive");
      }
      setReports((rs) =>
        rs.map((r) =>
          r.id === id ? { ...r, archived_at: archived ? new Date().toISOString() : null } : r
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive");
    } finally {
      setUpdating((u) => ({ ...u, [id]: false }));
    }
  }, []);

  // Built from tags actually in use, not a fixed vocabulary — a topic nobody
  // has tagged is a filter nobody needs.
  const allTags = useMemo(
    () => Array.from(new Set(reports.flatMap((r) => r.tags ?? []))).sort((a, b) => a.localeCompare(b)),
    [reports]
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
      (reporterFilter === "all" || r.user_id === reporterFilter) &&
      (tagFilter === "all" || (r.tags ?? []).includes(tagFilter))
  );
  const archivedCount = reports.filter((r) => r.archived_at).length;
  // The archive is a separate shelf: everything else is the working list, so a
  // status view never mixes archived reports back in.
  const visible =
    statusFilter === "archived"
      ? scoped.filter((r) => r.archived_at)
      : scoped.filter(
          (r) => !r.archived_at && (statusFilter === "all" || r.status === statusFilter)
        );

  // Clamped rather than reset through an effect: archiving the last report on
  // the final page shortens the list, and a stale page number would otherwise
  // leave an empty screen.
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const countFor = (choice: StatusChoice) =>
    choice === "archived"
      ? scoped.filter((r) => r.archived_at).length
      : choice === "all"
        ? scoped.filter((r) => !r.archived_at).length
        : scoped.filter((r) => !r.archived_at && r.status === choice).length;

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
            onChange={(e) => { setTypeFilter(e.target.value as "all" | ReportType); setPage(1); }}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">All types</option>
            <option value="bug">Bugs</option>
            <option value="feature">Features</option>
          </select>
          <select
            value={reporterFilter}
            onChange={(e) => { setReporterFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">Everyone</option>
            {reporters.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
            >
              <option value="all">All topics</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag} className="capitalize">
                  {tag}
                </option>
              ))}
            </select>
          )}
          {/* Dropdown rather than pills: five statuses plus the type and
              reporter selects wrapped onto a second row at normal widths. */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusChoice); setPage(1); }}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">All statuses ({countFor("all")})</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status} className="capitalize">
                {status.charAt(0).toUpperCase() + status.slice(1)} ({countFor(status)})
              </option>
            ))}
            <option value="archived">Archived ({countFor("archived")})</option>
          </select>
        </div>
      </div>

      <div className="p-5">
        {error && (
          <p className="mb-3 rounded-lg border border-terracotta/20 bg-terracotta-soft px-3 py-2 text-[11px] text-terracotta">
            {error}
          </p>
        )}

          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sage/30 bg-sage-soft px-3 py-2">
              <span className="text-[11px] font-semibold text-espresso">
                {selected.size} selected
              </span>

              <select
                disabled={bulkBusy}
                value=""
                onChange={(e) => {
                  const status = e.target.value;
                  if (status) applyToSelected(() => ({ status }));
                }}
                className="rounded-lg border border-sand bg-white px-2.5 py-1 text-[11px] text-espresso outline-none disabled:opacity-50"
              >
                <option value="">Set status…</option>
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status} className="capitalize">
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>

              <input
                list="bulk-topics"
                value={bulkTag}
                disabled={bulkBusy}
                onChange={(e) => setBulkTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const tag = bulkTag.trim().toLowerCase();
                  if (!tag) return;
                  setBulkTag("");
                  // Added to whatever each report already has, never replacing —
                  // a bulk action that quietly wiped existing topics would be a
                  // nasty surprise.
                  applyToSelected((r) =>
                    (r.tags ?? []).includes(tag) ? null : { tags: [...(r.tags ?? []), tag] }
                  );
                }}
                placeholder="Add topic — press Enter"
                className="w-[170px] rounded-lg border border-sand bg-white px-2.5 py-1 text-[11px] text-espresso outline-none disabled:opacity-50"
              />
              <datalist id="bulk-topics">
                {Array.from(new Set([...allTags])).map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>

              <button
                disabled={bulkBusy}
                onClick={() => applyToSelected((r) => ({ archived: !r.archived_at }))}
                className="rounded-lg bg-stone/10 px-2.5 py-1 text-[11px] font-semibold text-stone hover:bg-stone/20 disabled:opacity-50"
              >
                {statusFilter === "archived" ? "Restore" : "Archive"}
              </button>

              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto text-[11px] font-semibold text-bark hover:text-espresso"
              >
                Clear
              </button>

              {bulkBusy && <span className="text-[11px] text-bark">Applying…</span>}
            </div>
          )}

        {loading ? (
          <p className="py-8 text-center text-sm text-bark">Loading reports...</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-bark">
              {statusFilter === "archived" ? "Nothing archived yet." : "No reports match these filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pageItems.map((report) => {
              const type = (report.report_type || "bug") as ReportType;
              const isOpen = expandedId === report.id;
              return (
                <div key={report.id} className="rounded-lg border border-sand bg-white">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selected.has(report.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(report.id);
                        else next.delete(report.id);
                        setSelected(next);
                      }}
                      className="ml-3 h-3.5 w-3.5 shrink-0 accent-sage"
                      aria-label={`Select ${report.title}`}
                    />
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
                    {(report.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="shrink-0 rounded-full bg-slate-blue-soft px-1.5 py-[1px] text-[9px] font-semibold capitalize text-slate-blue"
                      >
                        {tag}
                      </span>
                    ))}
                    <span className="text-[11px] text-bark">
                      {report.full_name || report.username || "Unknown"}
                    </span>
                    <span className="text-[10px] text-stone">{formatWhen(report.created_at)}</span>
                    <span
                      className={`ml-auto rounded-full border px-2 py-[1px] text-[9px] font-semibold capitalize ${STATUS_STYLES[report.status]}`}
                    >
                      {report.status}
                    </span>
                    {report.handled_by_name && (
                      <span className="shrink-0 text-[10px] text-bark">
                        {report.handled_by_name}
                      </span>
                    )}
                  </button>
                  </div>

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

                      {/* Existing single note, kept read-only: it predates the
                          thread and the portal has always shown it. */}
                      {report.admin_notes && (
                        <p className="mt-2 text-xs italic text-bark">&quot;{report.admin_notes}&quot;</p>
                      )}

                      <BugReportTagEditor
                        reportId={report.id}
                        tags={report.tags ?? []}
                        knownTags={allTags}
                        canEdit
                        onSaved={(next) =>
                          setReports((rs) =>
                            rs.map((r) => (r.id === report.id ? { ...r, tags: next } : r))
                          )
                        }
                      />

                      <BugReportNotes
                        reportId={report.id}
                        currentUserId={currentUserId}
                        timezone={orgTimezone}
                      />

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

                        <button
                          disabled={updating[report.id]}
                          onClick={() => setArchived(report.id, !report.archived_at)}
                          className="ml-auto rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                        >
                          {report.archived_at ? "Restore" : "Archive"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-parchment pt-3">
            <span className="text-[11px] text-bark">
              Showing {(safePage - 1) * PAGE_SIZE + 1}&ndash;
              {Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((n) => Math.max(1, n - 1))}
                disabled={safePage <= 1}
                className="rounded-lg bg-stone/10 px-3 py-1 text-[11px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-[11px] text-bark">
                Page {safePage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                disabled={safePage >= totalPages}
                className="rounded-lg bg-stone/10 px-3 py-1 text-[11px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
