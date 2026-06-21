"use client";

import { useCallback, useEffect, useState } from "react";

type ProjectRecord = {
  id: string;
  name: string;
  account: string | null;
  description: string | null;
  details: string | null;
  notes: string | null;
  is_active?: boolean;
  created_at?: string;
};

type ProjectInfoModalProps = {
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
};

function parseErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function valueOrDash(value: string | null | undefined) {
  return value && value.trim() ? value : "—";
}

export default function ProjectInfoModal({ projectId, isOpen, onClose }: ProjectInfoModalProps) {
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [vaNote, setVaNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const loadProject = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setError("");
    setSavedMessage("");

    try {
      const [projectRes, noteRes] = await Promise.all([
        fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/projects/va-notes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      ]);

      if (!projectRes.ok) {
        let message = `HTTP ${projectRes.status}`;
        try {
          message = parseErrorMessage(await projectRes.json(), message);
        } catch {
          // ignore JSON parse failures
        }
        throw new Error(message);
      }

      const projectJson = (await projectRes.json()) as { project?: ProjectRecord | null };
      if (!projectJson.project) {
        throw new Error("Project not found");
      }
      setProject(projectJson.project);

      if (noteRes.ok) {
        const noteJson = (await noteRes.json()) as { note?: string | null };
        setVaNote(noteJson.note ?? "");
      } else if (noteRes.status === 404) {
        setVaNote("");
      } else {
        let message = `HTTP ${noteRes.status}`;
        try {
          message = parseErrorMessage(await noteRes.json(), message);
        } catch {
          // ignore JSON parse failures
        }
        setVaNote("");
        setError(message);
      }
    } catch (err) {
      setProject(null);
      setVaNote("");
      setError(err instanceof Error ? err.message : "Unable to load project information.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen && projectId) {
      void loadProject();
      return;
    }

    setProject(null);
    setVaNote("");
    setError("");
    setSavedMessage("");
  }, [isOpen, projectId, loadProject]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    if (!projectId) return;

    setSaving(true);
    setError("");
    setSavedMessage("");

    try {
      const res = await fetch("/api/projects/va-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, note: vaNote }),
      });

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          message = parseErrorMessage(await res.json(), message);
        } catch {
          // ignore JSON parse failures
        }
        throw new Error(message);
      }

      setSavedMessage("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save note.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-sand bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-espresso">Project Info</h2>
            <p className="mt-0.5 text-[11px] text-stone">View project details and keep your private VA note here.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-stone transition-colors hover:text-espresso"
            aria-label="Close project info modal"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-parchment/40 px-4 py-3">
            <div className="text-xs font-bold text-espresso">{project?.name ?? "Loading project..."}</div>
            <div className="mt-1 text-[11px] text-stone">
              Account: <span className="font-medium text-espresso">{valueOrDash(project?.account)}</span>
            </div>
          </div>

          {loading && !project ? (
            <div className="rounded-lg border border-dashed border-sand px-4 py-6 text-center text-xs text-stone">
              Loading project details...
            </div>
          ) : project ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4 md:col-span-1">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">Description</label>
                  <div className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap min-h-[84px]">
                    {valueOrDash(project.description)}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">Details</label>
                  <div className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap min-h-[120px]">
                    {valueOrDash(project.details)}
                  </div>
                </div>
              </div>

              <div className="space-y-4 md:col-span-1">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">Notes</label>
                  <div className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap min-h-[84px]">
                    {valueOrDash(project.notes)}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">Your VA Note</label>
                  <textarea
                    value={vaNote}
                    onChange={(event) => setVaNote(event.target.value)}
                    rows={7}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta resize-none"
                    placeholder="Add a private note for this project..."
                  />
                </div>
              </div>
            </div>
          ) : null}

          {error && <div className="rounded-lg bg-terracotta-soft px-3 py-2 text-xs text-terracotta">{error}</div>}
          {savedMessage && <div className="rounded-lg bg-sage-soft px-3 py-2 text-xs text-sage">{savedMessage}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-parchment px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-sand px-4 py-2 text-[13px] font-medium text-walnut transition-all hover:border-terracotta hover:text-terracotta"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !project}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
