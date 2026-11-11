"use client";

// Company-wide "Assets, Docs & Files" — Objectives, Operations, and Adhoc
// tasks combined into one view, instead of the Docs & Files card nested
// inside each Objective/Operation's own tab bar (ObjectiveOverview.tsx keeps
// that one untouched). Toni's call, 2026-11-11. Admin-only: this is a
// reporting/overview surface, not a per-VA one — the nested card inside each
// project is still how VAs see their own project's files.
//
// Deliberately a standalone page rather than an extraction of
// ObjectiveOverview's Docs card into a shared component — duplicating the
// filter/list JSX here is a smaller, safer footprint than refactoring code
// that's already working for every VA.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import PdfPreviewModal from "@/components/PdfPreviewModal";

type AssetRow = {
  id: string;
  project_id: string | null;
  project_kind: "objective" | "operation" | null;
  filename: string;
  uploaded_at: string;
  href?: string | null;
  account: string | null;
  task_id: number | null;
  task_name: string | null;
  person_id: string | null;
  person_name: string | null;
  mime_type?: string | null;
};
type DocRow = AssetRow & { source: "uploaded" | "submitted" };
type ProjectLite = { id: string; name: string; kind: "objective" | "operation" };

/** Same sitewide prefs id the nested Docs & Files card already uses — a file
 *  removed from one view stays removed in the other, since it's the same
 *  underlying "hidden from these lists" set, not a separate one. */
const DOCS_REMOVED_PREFS_ID = "docs-files-removed";
/** Stands in for project_id in the objective/operation filter's Set — real
 *  project ids are UUIDs, so this can't collide with one. */
const ADHOC_VALUE = "__adhoc__";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function docPreviewKind(f: AssetRow): "image" | "pdf" | null {
  if (!f.href || f.id.startsWith("link-")) return null;
  const mime = (f.mime_type ?? "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.filename)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(f.filename)) return "pdf";
  return null;
}

/** Simple pager, same shape as ObjectiveOverview's own. */
function Paginated<T>({ items, pageSize, empty, children }: {
  items: T[];
  pageSize: number;
  empty: React.ReactNode;
  children: (slice: T[]) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);
  if (items.length === 0) return <div className="flex-1 flex items-start">{empty}</div>;
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">{children(slice)}</div>
      {pages > 1 && (
        <div className="flex items-center justify-between pt-2 text-[11px] text-bark">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">‹ Prev</button>
          <span className="text-stone">{safePage + 1} / {pages}</span>
          <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">Next ›</button>
        </div>
      )}
    </div>
  );
}

export default function ProductivityAssetsPage() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [files, setFiles] = useState<AssetRow[]>([]);
  const [submittedFiles, setSubmittedFiles] = useState<AssetRow[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const [docsView, setDocsView] = useState<"all" | "uploaded" | "submitted">("all");
  const [docAccount, setDocAccount] = useState<Set<string>>(() => new Set());
  const [docTask, setDocTask] = useState<Set<string>>(() => new Set());
  const [docProject, setDocProject] = useState<Set<string>>(() => new Set());
  const [docPerson, setDocPerson] = useState<Set<string>>(() => new Set());
  const [removedDocIds, setRemovedDocIds] = useState<Set<string>>(new Set());
  const [showRemovedDocs, setShowRemovedDocs] = useState(false);
  const [docLightbox, setDocLightbox] = useState<{ urls: string[]; captions: string[]; index: number } | null>(null);
  const [docPdf, setDocPdf] = useState<{ url: string; filename: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setReady(true); return; }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(hasBroadAdminAccess(profile));
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoadingDocs(true);
      try {
        const res = await fetch("/api/projects/assets-overview", { cache: "no-store" });
        const d = await res.json();
        if (cancelled) return;
        setFiles((d.files ?? []) as AssetRow[]);
        setSubmittedFiles((d.submittedFiles ?? []) as AssetRow[]);
        setProjects((d.projects ?? []) as ProjectLite[]);
      } catch {
        if (!cancelled) { setFiles([]); setSubmittedFiles([]); setProjects([]); }
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, isAdmin]);

  const readRemovedDocIds = () =>
    fetch(`/api/table-prefs?tableId=${DOCS_REMOVED_PREFS_ID}&scope=sitewide`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => new Set<string>(Array.isArray(d?.prefs?.ids) ? (d.prefs.ids as string[]) : []))
      .catch(() => null);
  useEffect(() => {
    if (!ready || !isAdmin) return;
    let cancelled = false;
    void readRemovedDocIds().then((ids) => { if (!cancelled && ids) setRemovedDocIds(ids); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isAdmin]);

  const setDocRemoved = async (id: string, removed: boolean) => {
    setRemovedDocIds((prev) => {
      const next = new Set(prev);
      if (removed) next.add(id); else next.delete(id);
      return next;
    });
    const latest = (await readRemovedDocIds()) ?? new Set<string>(removedDocIds);
    if (removed) latest.add(id); else latest.delete(id);
    setRemovedDocIds(new Set(latest));
    await fetch("/api/table-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: DOCS_REMOVED_PREFS_ID, scope: "sitewide", prefs: { ids: Array.from(latest) } }),
    }).catch(() => {});
  };

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const docsInView = useMemo<DocRow[]>(() => {
    const uploaded = files.map((f) => ({ ...f, source: "uploaded" as const }));
    const submitted = submittedFiles.map((f) => ({ ...f, source: "submitted" as const }));
    const rows = docsView === "uploaded" ? uploaded : docsView === "submitted" ? submitted : [...uploaded, ...submitted];
    return rows
      .filter((f) => showRemovedDocs === removedDocIds.has(f.id))
      .sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  }, [files, submittedFiles, docsView, removedDocIds, showRemovedDocs]);

  const docOptions = useMemo(() => {
    const accounts = new Set<string>();
    const tasks = new Set<string>();
    const people = new Map<string, string>();
    for (const f of docsInView) {
      if (f.account) accounts.add(f.account);
      if (f.task_name) tasks.add(f.task_name);
      if (f.person_id) people.set(f.person_id, f.person_name || "Unknown");
    }
    const byText = (a: string, b: string) => a.localeCompare(b);
    const projectOptions: [string, string][] = projects
      .map((p) => [p.id, `${p.name} (${p.kind === "objective" ? "Objective" : "Operation"})`] as [string, string])
      .sort((a, b) => byText(a[1], b[1]));
    return {
      accounts: [...accounts].sort(byText),
      tasks: [...tasks].sort(byText),
      projects: [[ADHOC_VALUE, "Adhoc"] as [string, string], ...projectOptions],
      people: [...people.entries()].sort((a, b) => byText(a[1], b[1])),
    };
  }, [docsInView, projects]);

  const filteredDocs = useMemo(
    () =>
      docsInView.filter(
        (f) =>
          (docAccount.size === 0 || (f.account != null && docAccount.has(f.account))) &&
          (docTask.size === 0 || (f.task_name != null && docTask.has(f.task_name))) &&
          (docProject.size === 0 || docProject.has(f.project_id ?? ADHOC_VALUE)) &&
          (docPerson.size === 0 || (f.person_id != null && docPerson.has(f.person_id)))
      ),
    [docsInView, docAccount, docTask, docProject, docPerson]
  );
  const removedDocCount = useMemo(
    () => [...files, ...submittedFiles].filter((f) => removedDocIds.has(f.id)).length,
    [files, submittedFiles, removedDocIds]
  );
  const docFiltersOn = docAccount.size + docTask.size + docProject.size + docPerson.size > 0;

  if (!ready) return <div className="p-8 text-center text-xs text-stone">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-xs text-stone">
        Assets, Docs &amp; Files is an admin view — see your project&apos;s own Assets tab instead.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide mb-0">
          Assets, Docs &amp; Files — Everything
        </h3>
        <div className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
          {([["all", "All"], ["uploaded", "Uploaded"], ["submitted", "Submitted"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setDocsView(v)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${docsView === v ? "bg-white text-espresso shadow-sm" : "text-walnut hover:text-espresso"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          [docAccount, setDocAccount, "All accounts", docOptions.accounts.map((a) => [a, a] as const)],
          [docTask, setDocTask, "All tasks", docOptions.tasks.map((t) => [t, t] as const)],
          [docProject, setDocProject, "All objectives/operations", docOptions.projects],
          [docPerson, setDocPerson, "Everyone", docOptions.people],
        ] as const).map(([value, setValue, allLabel, options]) => {
          const opts = options.map(([v, label]) => ({ value: v, label }));
          for (const v of value) if (!opts.some((o) => o.value === v)) opts.push({ value: v, label: v });
          return (
            <MultiSelectFilter key={allLabel} allLabel={allLabel} options={opts} selected={value} onChange={setValue} />
          );
        })}
        {docFiltersOn && (
          <button
            type="button"
            onClick={() => { setDocAccount(new Set()); setDocTask(new Set()); setDocProject(new Set()); setDocPerson(new Set()); }}
            className="px-2 py-[3px] text-[10px] font-semibold text-bark hover:text-espresso"
          >
            Clear
          </button>
        )}
        {(removedDocCount > 0 || showRemovedDocs) && (
          <button
            type="button"
            onClick={() => setShowRemovedDocs((v) => !v)}
            className={`ml-auto px-2 py-[3px] rounded-full text-[10px] font-semibold border transition-colors ${showRemovedDocs ? "bg-sage text-white border-sage" : "bg-white text-walnut border-sand hover:border-stone"}`}
          >
            Removed ({removedDocCount})
          </button>
        )}
      </div>
      {loadingDocs ? (
        <p className="text-[12px] text-stone">Loading…</p>
      ) : (
        <Paginated
          items={filteredDocs}
          pageSize={15}
          empty={
            <p className="text-[12px] text-walnut">
              {showRemovedDocs
                ? "Nothing removed."
                : docFiltersOn
                  ? "Nothing matches these filters."
                  : docsView === "submitted"
                    ? "Nothing submitted yet."
                    : docsView === "uploaded"
                      ? "No uploaded files yet."
                      : "No files yet."}
            </p>
          }
        >
          {(slice) => (
            <div className="space-y-1.5">
              {slice.map((f) => {
                const proj = f.project_id ? projectById.get(f.project_id) : null;
                const scope = proj ? (proj.kind === "objective" ? "Objective" : "Operation") : "Adhoc";
                const meta = [proj?.name ?? scope, f.task_name, f.account, f.person_name].filter(Boolean).join(" · ");
                const inner = (
                  <>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12px] text-espresso truncate">{f.href ? "🔗 " : ""}{f.filename}</span>
                        {docsView === "all" && (
                          <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${
                            f.source === "submitted"
                              ? "bg-sky-50 text-sky-600 border-sky-200"
                              : "bg-stone/10 text-stone border-stone/20"
                          }`}>
                            {f.source === "submitted" ? "Submitted" : "Uploaded"}
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-bark truncate">{meta}</span>
                    </span>
                    <span className="text-[10px] text-bark shrink-0">{formatDate(f.uploaded_at)}</span>
                  </>
                );
                const rowClass = "min-w-0 flex-1 text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-cream transition-colors";
                return (
                  <div key={f.id} className="flex items-center gap-1">
                    {f.href && docPreviewKind(f) ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (docPreviewKind(f) === "pdf") {
                            setDocPdf({ url: f.href as string, filename: f.filename });
                            return;
                          }
                          setDocLightbox({ urls: [f.href as string], captions: [f.filename], index: 0 });
                        }}
                        className={rowClass}
                      >
                        {inner}
                      </button>
                    ) : f.href ? (
                      <a href={f.href} target="_blank" rel="noreferrer" className={rowClass}>
                        {inner}
                      </a>
                    ) : (
                      <div className={rowClass}>{inner}</div>
                    )}
                    {showRemovedDocs ? (
                      <button
                        type="button"
                        onClick={() => void setDocRemoved(f.id, false)}
                        className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold text-sage hover:bg-sage-soft transition-colors"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setDocRemoved(f.id, true)}
                        title="Remove from this list (the file itself is kept)"
                        aria-label="Remove from this list"
                        className="shrink-0 h-6 w-6 rounded text-[13px] leading-none text-stone hover:text-terracotta hover:bg-terracotta-soft transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Paginated>
      )}

      {docLightbox && (
        <ScreenshotLightbox
          urls={docLightbox.urls}
          captions={docLightbox.captions}
          initialIndex={docLightbox.index}
          onClose={() => setDocLightbox(null)}
        />
      )}
      {docPdf && (
        <PdfPreviewModal url={docPdf.url} filename={docPdf.filename} onClose={() => setDocPdf(null)} />
      )}
    </div>
  );
}
