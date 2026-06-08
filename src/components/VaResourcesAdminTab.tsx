"use client";

import { useEffect, useState, useCallback } from "react";

interface VaResource {
  id: string;
  type: string;
  title: string;
  content: string | null;
  url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

const RESOURCE_TYPES = [
  { value: "sop", label: "SOP" },
] as const;

type ResourceType = typeof RESOURCE_TYPES[number]["value"];

const TYPE_LABELS: Record<string, string> = {
  sop: "SOP",
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  sop: { bg: "bg-slate-blue-soft", text: "text-slate-blue" },
};

export default function VaResourcesAdminTab() {
  const [resources, setResources] = useState<VaResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<ResourceType | "all">("all");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<ResourceType>("sop");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newSortOrder, setNewSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSortOrder, setEditSortOrder] = useState("0");
  const [editSaving, setEditSaving] = useState(false);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all resources including inactive (admin sees all)
      const res = await fetch("/api/va-resources");
      const data = await res.json();
      // Also fetch inactive by querying directly — for admin we need all
      setResources(data.resources || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) {
      setSaveError("Title is required.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/va-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          title: newTitle.trim(),
          content: newContent.trim() || null,
          url: newUrl.trim() || null,
          sort_order: parseInt(newSortOrder, 10) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to create resource.");
        setSaving(false);
        return;
      }
      setResources((prev) => [...prev, data.resource]);
      setNewTitle("");
      setNewContent("");
      setNewUrl("");
      setNewSortOrder("0");
      setShowAddForm(false);
    } catch {
      setSaveError("Network error.");
    } finally {
      setSaving(false);
    }
  }, [newType, newTitle, newContent, newUrl, newSortOrder]);

  const handleToggleActive = useCallback(async (resource: VaResource) => {
    const res = await fetch(`/api/va-resources?id=${resource.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !resource.is_active }),
    });
    if (res.ok) {
      setResources((prev) =>
        prev.map((r) => r.id === resource.id ? { ...r, is_active: !r.is_active } : r)
      );
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this resource? This cannot be undone.")) return;
    const res = await fetch(`/api/va-resources?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setResources((prev) => prev.filter((r) => r.id !== id));
    }
  }, []);

  const startEdit = useCallback((r: VaResource) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditContent(r.content || "");
    setEditUrl(r.url || "");
    setEditSortOrder(String(r.sort_order));
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingId) return;
    setEditSaving(true);
    const res = await fetch(`/api/va-resources?id=${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim(),
        content: editContent.trim() || null,
        url: editUrl.trim() || null,
        sort_order: parseInt(editSortOrder, 10) || 0,
      }),
    });
    setEditSaving(false);
    if (res.ok) {
      const data = await res.json();
      setResources((prev) =>
        prev.map((r) => r.id === editingId ? data.resource : r)
      );
      setEditingId(null);
    }
  }, [editingId, editTitle, editContent, editUrl, editSortOrder]);

  const filteredResources = filterType === "all"
    ? resources
    : resources.filter((r) => r.type === filterType);

  const sortedResources = [...filteredResources].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.sort_order - b.sort_order;
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {/* Type filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterType("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              filterType === "all"
                ? "bg-espresso text-white"
                : "bg-parchment text-bark hover:bg-sand"
            }`}
          >
            All ({resources.length})
          </button>
          {RESOURCE_TYPES.map((t) => {
            const count = resources.filter((r) => r.type === t.value).length;
            const colors = TYPE_COLORS[t.value];
            return (
              <button
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  filterType === t.value
                    ? `${colors.bg} ${colors.text} ring-1 ring-current`
                    : "bg-parchment text-bark hover:bg-sand"
                }`}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>

        <button
          onClick={() => { setShowAddForm(true); setSaveError(""); }}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-4 py-2 text-xs font-semibold text-white cursor-pointer hover:bg-[#a85840] transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Resource
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="mb-5 rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-espresso">New Resource</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Type <span className="text-terracotta">*</span></label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as ResourceType)}
                className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              >
                {RESOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Title <span className="text-terracotta">*</span></label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Resource title"
                className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Content</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Body text or description (optional)"
                rows={3}
                className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Link URL</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Sort Order</label>
              <input
                type="number"
                value={newSortOrder}
                onChange={(e) => setNewSortOrder(e.target.value)}
                min="0"
                className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
          </div>
          {saveError && (
            <p className="mt-3 text-xs text-red-500">{saveError}</p>
          )}
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="rounded-lg bg-terracotta px-4 py-2 text-xs font-semibold text-white cursor-pointer hover:bg-[#a85840] disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Resource"}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setSaveError(""); }}
              className="rounded-lg bg-parchment px-4 py-2 text-xs font-semibold text-bark cursor-pointer hover:bg-sand"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Resources list */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading resources...
        </div>
      ) : sortedResources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No resources yet</p>
          <p className="mt-1 text-xs text-stone">Click &quot;Add Resource&quot; to create the first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedResources.map((r) => {
            const colors = TYPE_COLORS[r.type] || { bg: "bg-parchment", text: "text-bark" };
            const isEditing = editingId === r.id;
            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-white p-4 shadow-sm transition-opacity ${!r.is_active ? "opacity-50" : ""} ${isEditing ? "border-terracotta ring-1 ring-terracotta" : "border-sand"}`}
              >
                {isEditing ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink outline-none focus:border-terracotta"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Sort Order</label>
                        <input
                          type="number"
                          value={editSortOrder}
                          onChange={(e) => setEditSortOrder(e.target.value)}
                          className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink outline-none focus:border-terracotta"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Content</label>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink outline-none focus:border-terracotta resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Link URL</label>
                      <input
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink outline-none focus:border-terracotta"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleEditSave}
                        disabled={editSaving}
                        className="rounded-lg bg-terracotta px-4 py-1.5 text-xs font-semibold text-white cursor-pointer hover:bg-[#a85840] disabled:opacity-50"
                      >
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg bg-parchment px-4 py-1.5 text-xs font-semibold text-bark cursor-pointer hover:bg-sand"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                          {TYPE_LABELS[r.type] || r.type}
                        </span>
                        {!r.is_active && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-parchment text-stone">
                            Hidden
                          </span>
                        )}
                        <span className="text-[10px] text-stone">Sort: {r.sort_order}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-espresso">{r.title}</h3>
                      {r.content && (
                        <p className="mt-1 text-xs text-bark line-clamp-2 whitespace-pre-wrap">{r.content}</p>
                      )}
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-terracotta hover:underline"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          {r.url.length > 50 ? r.url.slice(0, 50) + "..." : r.url}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(r)}
                        title="Edit"
                        className="rounded-lg p-1.5 text-bark hover:bg-parchment cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleToggleActive(r)}
                        title={r.is_active ? "Hide from VAs" : "Show to VAs"}
                        className={`rounded-lg p-1.5 cursor-pointer ${r.is_active ? "text-sage hover:bg-sage-soft" : "text-stone hover:bg-parchment"}`}
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {r.is_active ? (
                            <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                          ) : (
                            <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                          )}
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        title="Delete"
                        className="rounded-lg p-1.5 text-bark hover:bg-red-50 hover:text-red-500 cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
