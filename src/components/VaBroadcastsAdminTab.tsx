"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BroadcastRecipient {
  id?: string;
  recipient_type?: string;
  recipient_value?: string;
  // legacy shape used by some callers
  type?: string;
  value?: string;
}

interface Broadcast {
  id: string;
  title: string;
  body: string;
  category: "memo" | "training" | "announcement" | "coaching_notes" | "job_posting" | "onboarding";
  magic_word: string | null;
  require_word: boolean;
  status: "draft" | "published" | "archived" | "scheduled";
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  read_count: number;
  recipients: BroadcastRecipient[];
  link: string | null;
  image_url: string | null;
  sort_order: number;
}

interface TeamMember {
  id: string;
  full_name: string | null;
  employment_type: string | null;
  role: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { label: string; value: Broadcast["category"] }[] = [
  { label: "Memo", value: "memo" },
  { label: "Training", value: "training" },
  { label: "Announcement", value: "announcement" },
  { label: "Coaching Notes", value: "coaching_notes" },
  { label: "Job Posting", value: "job_posting" },
  { label: "Onboarding", value: "onboarding" },
];

const EMPLOYMENT_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: "Full Time", value: "full_time" },
  { label: "Part Time", value: "part_time" },
  { label: "Hourly", value: "hourly" },
  { label: "Per Task", value: "per_task" },
];

type RecipientMode = "all" | "role_va" | "employment_type" | "individual";
type PublishMode = "immediate" | "scheduled" | "draft";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function recipientLabel(recipients: BroadcastRecipient[]): string {
  if (!recipients || recipients.length === 0) return "Everyone";
  const first = recipients[0];
  const type = first.recipient_type ?? first.type;
  const value = first.recipient_value ?? first.value;

  if (type === "all") return "Everyone";
  if (type === "role" && value === "va") return "All VAs";
  if (type === "employment_type") {
    const labels = recipients
      .map((r) => {
        const v = r.recipient_value ?? r.value ?? "";
        return EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;
      })
      .join(", ");
    return `Emp. Type: ${labels}`;
  }
  if (type === "individual") {
    return `${recipients.length} individual${recipients.length !== 1 ? "s" : ""}`;
  }
  return `${type}: ${value}`;
}

function parseRecipientsForEdit(recipients: BroadcastRecipient[]): {
  mode: RecipientMode;
  empTypes: string[];
  individuals: string[];
} {
  if (!recipients || recipients.length === 0) {
    return { mode: "all", empTypes: [], individuals: [] };
  }
  const first = recipients[0];
  const type = first.recipient_type ?? first.type;
  const value = first.recipient_value ?? first.value;

  if (type === "all") return { mode: "all", empTypes: [], individuals: [] };
  if (type === "role" && value === "va") return { mode: "role_va", empTypes: [], individuals: [] };
  if (type === "employment_type") {
    const empTypes = recipients.map((r) => (r.recipient_value ?? r.value) as string);
    return { mode: "employment_type", empTypes, individuals: [] };
  }
  if (type === "individual") {
    const individuals = recipients.map((r) => (r.recipient_value ?? r.value) as string);
    return { mode: "individual", empTypes: [], individuals };
  }
  return { mode: "all", empTypes: [], individuals: [] };
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: Broadcast["category"] }) {
  const styles: Record<Broadcast["category"], string> = {
    memo: "bg-sage-soft text-sage",
    training: "bg-slate-blue-soft text-slate-blue",
    announcement: "bg-terracotta-soft text-terracotta",
    coaching_notes: "bg-amber-100 text-amber-700",
    job_posting: "bg-terracotta-soft text-terracotta",
    onboarding: "bg-sage-soft text-sage",
  };
  const labels: Record<Broadcast["category"], string> = {
    memo: "Memo",
    training: "Training",
    announcement: "Announcement",
    coaching_notes: "Coaching Notes",
    job_posting: "Job Posting",
    onboarding: "Onboarding",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[category]}`}>
      {labels[category]}
    </span>
  );
}

function StatusBadge({ status, scheduledAt }: { status: Broadcast["status"]; scheduledAt: string | null }) {
  const map: Record<Broadcast["status"], { cls: string; label: string }> = {
    published: { cls: "bg-sage-soft text-sage", label: "Published" },
    draft: { cls: "bg-amber-50 text-amber-700", label: "Draft" },
    archived: { cls: "bg-stone/10 text-stone", label: "Archived" },
    scheduled: { cls: "bg-slate-blue-soft text-slate-blue", label: scheduledAt ? `Scheduled ${fmtDateTime(scheduledAt)}` : "Scheduled" },
  };
  const { cls, label } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VaBroadcastsAdminTab() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── Form state ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Broadcast["category"]>("memo");

  // Recipients
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("all");
  const [selectedEmpTypes, setSelectedEmpTypes] = useState<string[]>([]);
  const [selectedIndividuals, setSelectedIndividuals] = useState<string[]>([]);

  // Magic word
  const [addMagicWord, setAddMagicWord] = useState(false);
  const [magicWord, setMagicWord] = useState("");
  const [requireWord, setRequireWord] = useState(false);

  // Link, image, sort order
  const [link, setLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);

  // Publish
  const [publishMode, setPublishMode] = useState<PublishMode>("immediate");
  const [scheduledAt, setScheduledAt] = useState("");

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/broadcasts");
      const d = await res.json();
      setBroadcasts(d.broadcasts || d || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/team-members");
      if (res.ok) {
        const d = await res.json();
        setTeamMembers(d.members || []);
      }
    } catch {
      // silently ignore — individual picker just won't populate
    }
  }, []);

  useEffect(() => {
    fetchBroadcasts();
    fetchTeamMembers();
  }, [fetchBroadcasts, fetchTeamMembers]);

  // ── Form helpers ─────────────────────────────────────────────────────────────

  const resetForm = () => {
    setTitle("");
    setBody("");
    setCategory("memo");
    setRecipientMode("all");
    setSelectedEmpTypes([]);
    setSelectedIndividuals([]);
    setAddMagicWord(false);
    setMagicWord("");
    setRequireWord(false);
    setLink("");
    setImageUrl("");
    setSortOrder(0);
    setPublishMode("immediate");
    setScheduledAt("");
    setEditing(null);
  };

  const openEdit = (b: Broadcast) => {
    setEditing(b);
    setTitle(b.title);
    setBody(b.body);
    setCategory(b.category);

    const { mode, empTypes, individuals } = parseRecipientsForEdit(b.recipients);
    setRecipientMode(mode);
    setSelectedEmpTypes(empTypes);
    setSelectedIndividuals(individuals);

    setAddMagicWord(!!b.magic_word);
    setMagicWord(b.magic_word || "");
    setRequireWord(b.require_word);

    setLink(b.link || "");
    setImageUrl(b.image_url || "");
    setSortOrder(b.sort_order ?? 0);

    if (b.status === "scheduled") {
      setPublishMode("scheduled");
      setScheduledAt(b.scheduled_at ? b.scheduled_at.slice(0, 16) : ""); // format for datetime-local
    } else if (b.status === "draft") {
      setPublishMode("draft");
      setScheduledAt("");
    } else {
      setPublishMode("immediate");
      setScheduledAt("");
    }

    setShowForm(true);
  };

  // Build recipients array from current form state
  const buildRecipients = (): { type: string; value: string }[] => {
    if (recipientMode === "all") return [{ type: "all", value: "all" }];
    if (recipientMode === "role_va") return [{ type: "role", value: "va" }];
    if (recipientMode === "employment_type") {
      if (selectedEmpTypes.length === 0) return [{ type: "all", value: "all" }];
      return selectedEmpTypes.map((t) => ({ type: "employment_type", value: t }));
    }
    if (recipientMode === "individual") {
      if (selectedIndividuals.length === 0) return [{ type: "all", value: "all" }];
      return selectedIndividuals.map((id) => ({ type: "individual", value: id }));
    }
    return [{ type: "all", value: "all" }];
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(
    async (forceDraft?: boolean) => {
      if (!title.trim() || !body.trim()) return;
      setSaving(true);
      setSaveMsg(null);

      const resolvedMode = forceDraft ? "draft" : publishMode;
      let status: string;
      let scheduled_at: string | null = null;

      if (resolvedMode === "immediate") {
        status = "published";
      } else if (resolvedMode === "scheduled") {
        status = "scheduled";
        scheduled_at = scheduledAt ? new Date(scheduledAt).toISOString() : null;
      } else {
        status = "draft";
      }

      const payload = {
        title: title.trim(),
        body: body.trim(),
        category,
        recipients: buildRecipients(),
        magic_word: addMagicWord && magicWord.trim() ? magicWord.trim() : null,
        require_word: addMagicWord ? requireWord : false,
        status,
        scheduled_at,
        link: link.trim() || null,
        image_url: imageUrl.trim() || null,
        sort_order: sortOrder,
      };

      const res = editing
        ? await fetch(`/api/broadcasts?id=${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/broadcasts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      setSaving(false);
      if (res.ok) {
        const successText =
          resolvedMode === "draft"
            ? "Saved as draft"
            : resolvedMode === "scheduled"
            ? "Broadcast scheduled!"
            : editing
            ? "Broadcast updated!"
            : "Broadcast published!";
        setSaveMsg({ type: "ok", text: successText });
        setTimeout(() => setSaveMsg(null), 4000);
        resetForm();
        setShowForm(false);
        fetchBroadcasts();
      } else {
        const e = await res.json();
        setSaveMsg({ type: "err", text: e.error || "Failed to save" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, body, category, recipientMode, selectedEmpTypes, selectedIndividuals, addMagicWord, magicWord, requireWord, publishMode, scheduledAt, editing, fetchBroadcasts, link, imageUrl, sortOrder]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this broadcast? This cannot be undone.")) return;
      setDeleting((d) => ({ ...d, [id]: true }));
      await fetch(`/api/broadcasts?id=${id}`, { method: "DELETE" });
      await fetchBroadcasts();
      setDeleting((d) => ({ ...d, [id]: false }));
    },
    [fetchBroadcasts]
  );

  // ── Toggle helpers ───────────────────────────────────────────────────────────

  const toggleEmpType = (val: string) => {
    setSelectedEmpTypes((prev) =>
      prev.includes(val) ? prev.filter((t) => t !== val) : [...prev, val]
    );
  };

  const toggleIndividual = (id: string) => {
    setSelectedIndividuals((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Image upload handler
  const handleImageUpload = useCallback(async (file: File) => {
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/broadcasts/upload-image", { method: "POST", body: form });
      if (res.ok) {
        const d = await res.json();
        setImageUrl(d.url || "");
      } else {
        const e = await res.json();
        setSaveMsg({ type: "err", text: e.error || "Image upload failed" });
      }
    } catch {
      setSaveMsg({ type: "err", text: "Image upload failed" });
    } finally {
      setUploadingImage(false);
    }
  }, []);

  // VAs only (not admin) for individual selection
  const vaMembers = teamMembers.filter((m) => m.role === "va");

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Broadcast
        </button>
      </div>

      {/* ── Form ─────────────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">
            {editing ? "Edit Broadcast" : "New Broadcast"}
          </h3>

          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Broadcast title"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Message *
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Write your broadcast..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Broadcast["category"])}
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Recipients */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                Send To
              </label>
              <div className="space-y-2">
                {/* Everyone */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="recipientMode"
                    checked={recipientMode === "all"}
                    onChange={() => setRecipientMode("all")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Everyone</span>
                </label>

                {/* All VAs */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="recipientMode"
                    checked={recipientMode === "role_va"}
                    onChange={() => setRecipientMode("role_va")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">All VAs</span>
                </label>

                {/* By Employment Type */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="recipientMode"
                    checked={recipientMode === "employment_type"}
                    onChange={() => setRecipientMode("employment_type")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">By Employment Type</span>
                </label>

                {recipientMode === "employment_type" && (
                  <div className="ml-6 flex flex-wrap gap-3 pt-1">
                    {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEmpTypes.includes(opt.value)}
                          onChange={() => toggleEmpType(opt.value)}
                          className="accent-terracotta"
                        />
                        <span className="text-[13px] text-walnut">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {/* Specific Individuals */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="recipientMode"
                    checked={recipientMode === "individual"}
                    onChange={() => setRecipientMode("individual")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Specific Individuals</span>
                </label>

                {recipientMode === "individual" && (
                  <div className="ml-6 space-y-1.5 pt-1">
                    {vaMembers.length === 0 ? (
                      <p className="text-[12px] text-stone">Loading team members...</p>
                    ) : (
                      vaMembers.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedIndividuals.includes(m.id)}
                            onChange={() => toggleIndividual(m.id)}
                            className="accent-terracotta"
                          />
                          <span className="text-[13px] text-walnut">{m.full_name || "Unnamed"}</span>
                          {m.employment_type && (
                            <span className="text-[11px] text-stone capitalize">
                              ({m.employment_type.replace(/_/g, " ")})
                            </span>
                          )}
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Magic Word */}
            <div className="rounded-lg border border-sand bg-parchment p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addMagicWord}
                  onChange={(e) => setAddMagicWord(e.target.checked)}
                  className="accent-terracotta"
                />
                <span className="text-[13px] font-semibold text-walnut">Add magic word</span>
              </label>
              {addMagicWord && (
                <div className="space-y-3 pl-5">
                  <div>
                    <input
                      type="text"
                      value={magicWord}
                      onChange={(e) => setMagicWord(e.target.value)}
                      placeholder="Enter magic word..."
                      className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                    />
                    <p className="mt-1 text-[11px] text-stone">
                      The magic word will be automatically inserted into the message body.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireWord}
                      onChange={(e) => setRequireWord(e.target.checked)}
                      className="accent-terracotta"
                    />
                    <span className="text-[13px] text-walnut">Require magic word to acknowledge</span>
                  </label>
                </div>
              )}
            </div>

            {/* Link */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Link (optional)
              </label>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>

            {/* Image upload */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Image (optional)
              </label>
              {imageUrl ? (
                <div className="relative w-full rounded-lg overflow-hidden border border-sand mb-2">
                  <img src={imageUrl} alt="Broadcast image" className="w-full max-h-48 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl("")}
                    className="absolute top-2 right-2 rounded-full bg-white/80 p-1 text-espresso hover:bg-white shadow cursor-pointer"
                    title="Remove image"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer w-fit rounded-lg border border-sand px-4 py-2 text-[13px] text-walnut hover:border-walnut transition-all">
                  {uploadingImage ? (
                    <>
                      <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      Upload image
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImageUpload(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            {/* Sort Order */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Sort Order
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                min={0}
                className="w-24 py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
              <p className="mt-1 text-[11px] text-stone">Lower number = shows first. 0 = default order.</p>
            </div>

            {/* Publish options */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                When to Publish
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="publishMode"
                    checked={publishMode === "immediate"}
                    onChange={() => setPublishMode("immediate")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Publish immediately</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="publishMode"
                    checked={publishMode === "scheduled"}
                    onChange={() => setPublishMode("scheduled")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Schedule for later</span>
                </label>

                {publishMode === "scheduled" && (
                  <div className="ml-6 pt-1">
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="publishMode"
                    checked={publishMode === "draft"}
                    onChange={() => setPublishMode("draft")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Save as draft</span>
                </label>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <button
              onClick={() => handleSave(false)}
              disabled={saving || !title.trim() || !body.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? "Saving..."
                : publishMode === "draft"
                ? "Save Draft"
                : publishMode === "scheduled"
                ? "Schedule Broadcast"
                : editing
                ? "Save Changes"
                : "Publish Broadcast"}
            </button>

            {publishMode !== "draft" && (
              <button
                onClick={() => handleSave(true)}
                disabled={saving || !title.trim() || !body.trim()}
                className="rounded-lg border border-sand px-5 py-2.5 text-[13px] font-semibold text-walnut cursor-pointer transition-all hover:border-walnut disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save as Draft
              </button>
            )}

            <button
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="text-xs text-stone hover:text-espresso cursor-pointer"
            >
              Cancel
            </button>

            {saveMsg && (
              <p
                className={`text-xs font-medium ${
                  saveMsg.type === "ok" ? "text-sage" : "text-red-500"
                }`}
              >
                {saveMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading...
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {!loading && broadcasts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No broadcasts yet</p>
          <p className="mt-1 text-xs text-stone">
            Click &quot;New Broadcast&quot; to send your first broadcast.
          </p>
        </div>
      )}

      {/* ── Broadcast list ────────────────────────────────────────────────────── */}
      {!loading && broadcasts.length > 0 && (
        <div className="space-y-4">
          {broadcasts.map((b) => (
            <div
              key={b.id}
              className="rounded-xl border border-sand bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-espresso">{b.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-stone">{fmtDate(b.created_at)}</span>
                    <CategoryBadge category={b.category} />
                    <StatusBadge status={b.status} scheduledAt={b.scheduled_at} />
                    <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-medium text-sage">
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {b.read_count ?? 0} acknowledged
                    </span>
                    {b.magic_word && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[11px] font-medium text-terracotta">
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Magic word
                      </span>
                    )}
                    <span className="text-[11px] text-stone">{recipientLabel(b.recipients)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(b)}
                    className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    disabled={!!deleting[b.id]}
                    className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50"
                  >
                    {deleting[b.id] ? "..." : "Delete"}
                  </button>
                </div>
              </div>

              <div
                className={`text-xs text-bark leading-relaxed whitespace-pre-wrap ${
                  !expanded[b.id] && b.body.length > 200 ? "line-clamp-3" : ""
                }`}
              >
                {b.body}
              </div>
              {b.body.length > 200 && (
                <button
                  onClick={() =>
                    setExpanded((e) => ({ ...e, [b.id]: !e[b.id] }))
                  }
                  className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer"
                >
                  {expanded[b.id] ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
