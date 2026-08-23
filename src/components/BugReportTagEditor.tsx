"use client";

import { useEffect, useRef, useState } from "react";
import { REPORT_TAG_SUGGESTIONS } from "@/components/ReportIssueModal";

/**
 * Topics on a report that already exists.
 *
 * Picking is multi-select: open the list, tick everything that applies, done.
 * Earlier versions saved on every single tick, so tagging a report with three
 * topics meant three round trips and three re-renders — one topic at a time for
 * no reason. Changes are held locally and written once when the list closes.
 *
 * Tagging is triage, so reviewers can retag at any point; whoever filed the
 * report can tag it while it is still theirs to edit. The route enforces both.
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
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(tags);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Clicking away is how people close a menu, and it has to save rather than
  // silently discard what was just ticked.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const same =
    picked.length === tags.length && picked.every((t) => tags.includes(t));

  useEffect(() => {
    if (open || same) return;
    let cancelled = false;
    (async () => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/bug-reports?id=${reportId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: picked }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save topics");
        if (!cancelled) onSaved(data.report?.tags ?? picked);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not save topics");
          setPicked(tags); // Put the chips back to what is actually stored.
        }
      } finally {
        if (!cancelled) setSaving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!canEdit && tags.length === 0) return null;

  const options = Array.from(
    new Set([...REPORT_TAG_SUGGESTIONS, ...knownTags, ...picked])
  ).sort((a, b) => a.localeCompare(b));

  const toggle = (tag: string) =>
    setPicked((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-slate-blue-soft px-2 py-[2px] text-[10px] font-semibold capitalize text-slate-blue"
        >
          {tag}
        </span>
      ))}

      {canEdit && (
        <div className="relative" ref={panelRef}>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPicked(tags);
              setOpen((v) => !v);
            }}
            className="rounded-full bg-stone/10 px-2 py-[2px] text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
          >
            {saving ? "Saving…" : tags.length > 0 ? "Edit topics" : "+ Topics"}
          </button>

          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-sand bg-white p-2 shadow-lg">
              <div className="max-h-52 overflow-y-auto">
                {options.map((tag) => (
                  <label
                    key={tag}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] capitalize text-espresso hover:bg-cream"
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(tag)}
                      onChange={() => toggle(tag)}
                      className="h-3 w-3 accent-slate-blue"
                    />
                    {tag}
                  </label>
                ))}
              </div>

              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const next = draft.trim().toLowerCase();
                  setDraft("");
                  if (next && !picked.includes(next)) setPicked((c) => [...c, next]);
                }}
                placeholder="New topic — press Enter"
                className="mt-2 w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none focus:border-terracotta"
              />

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-2 w-full rounded-lg bg-sage px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {error && <span className="text-[10px] text-terracotta">{error}</span>}
    </div>
  );
}
