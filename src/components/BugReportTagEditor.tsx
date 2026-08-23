"use client";

import { useState } from "react";
import { REPORT_TAG_SUGGESTIONS } from "@/components/ReportIssueModal";

/**
 * Topics on a report that already exists.
 *
 * Shows what the report is tagged with and nothing else. An earlier version laid
 * out all ten suggestions as buttons on every expanded report, which spent a whole
 * row on options nobody was reaching for — tagging is occasional, reading the
 * report is not. Suggestions live in the input's datalist instead, so they appear
 * when you go looking for them.
 *
 * Tagging is triage, so reviewers can retag at any point; whoever filed the report
 * can tag it while it is still theirs to edit. The route enforces both.
 */
export default function BugReportTagEditor({
  reportId,
  tags,
  canEdit,
  knownTags = [],
  onSaved,
}: {
  reportId: number;
  tags: string[];
  canEdit: boolean;
  /** Topics already in use elsewhere, offered alongside the standard suggestions. */
  knownTags?: string[];
  onSaved: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bug-reports?id=${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save topics");
      onSaved(data.report?.tags ?? next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save topics");
    } finally {
      setSaving(false);
    }
  };

  const commit = () => {
    const next = draft.trim().toLowerCase();
    setDraft("");
    setAdding(false);
    if (next && !tags.includes(next)) save([...tags, next]);
  };

  if (!canEdit && tags.length === 0) return null;

  const options = Array.from(
    new Set([...REPORT_TAG_SUGGESTIONS, ...knownTags].filter((t) => !tags.includes(t)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-slate-blue-soft px-2 py-[2px] text-[10px] font-semibold capitalize text-slate-blue"
        >
          {tag}
          {canEdit && (
            <button
              type="button"
              disabled={saving}
              onClick={() => save(tags.filter((t) => t !== tag))}
              className="text-slate-blue/60 transition-colors hover:text-slate-blue"
              aria-label={`Remove ${tag}`}
            >
              &times;
            </button>
          )}
        </span>
      ))}

      {canEdit &&
        (adding ? (
          <>
            <input
              autoFocus
              list={`topics-${reportId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder="Topic name"
              className="w-[150px] rounded-full border border-sand bg-white px-2.5 py-[2px] text-[10px] text-espresso outline-none focus:border-terracotta"
            />
            <datalist id={`topics-${reportId}`}>
              {options.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => setAdding(true)}
            className="rounded-full bg-stone/10 px-2 py-[2px] text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
          >
            + Topic
          </button>
        ))}

      {error && <span className="text-[10px] text-terracotta">{error}</span>}
    </div>
  );
}
