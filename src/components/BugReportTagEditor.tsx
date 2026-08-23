"use client";

import { useState } from "react";
import { REPORT_TAG_SUGGESTIONS } from "@/components/ReportIssueModal";

/**
 * Tag editor for a report that already exists.
 *
 * Tagging only at submission time would have left every report filed before the
 * feature existed untaggable, and topics are mostly obvious in hindsight anyway —
 * you learn a report was really about payroll after reading it, not while writing
 * it. Reviewers can retag at any point; whoever filed the report can tag it while
 * it is still theirs to edit. The route enforces both.
 */
export default function BugReportTagEditor({
  reportId,
  tags,
  canEdit,
  onSaved,
}: {
  reportId: number;
  tags: string[];
  canEdit: boolean;
  onSaved: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
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

  const toggle = (tag: string) =>
    save(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);

  // Read-only reports still show their topics; there is just nothing to press.
  if (!canEdit) {
    if (tags.length === 0) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">Topics</span>
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-slate-blue-soft px-2 py-[1px] text-[10px] font-semibold capitalize text-slate-blue"
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }

  const custom = tags.filter(
    (t) => !REPORT_TAG_SUGGESTIONS.includes(t as (typeof REPORT_TAG_SUGGESTIONS)[number])
  );

  return (
    <div className="mt-3">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
        Topics
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {REPORT_TAG_SUGGESTIONS.map((tag) => {
          const on = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              disabled={saving}
              onClick={() => toggle(tag)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors disabled:opacity-50 ${
                on ? "bg-slate-blue text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
              }`}
            >
              {tag}
            </button>
          );
        })}

        {custom.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-slate-blue px-2.5 py-1 text-[10px] font-semibold capitalize text-white"
          >
            {tag}
            <button
              type="button"
              disabled={saving}
              onClick={() => toggle(tag)}
              className="text-white/70 hover:text-white"
              aria-label={`Remove ${tag}`}
            >
              &times;
            </button>
          </span>
        ))}

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              const next = draft.trim().toLowerCase();
              if (next && !tags.includes(next)) save([...tags, next]);
              setDraft("");
            }
          }}
          placeholder="Add a topic — press Enter"
          className="min-w-[160px] flex-1 rounded-lg border border-sand bg-white px-2.5 py-1 text-[11px] text-espresso outline-none focus:border-terracotta"
        />
      </div>
      {error && <p className="mt-1 text-[10px] text-terracotta">{error}</p>}
    </div>
  );
}
