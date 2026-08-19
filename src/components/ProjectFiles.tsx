"use client";

// Docs & Files tile for an Operation — a file cabinet (upload/download/
// organize), settled per Toni's answer 2 over editable in-app documents.
// Reuses the task-attachments bucket and the same upload/signed-URL pattern
// as TaskEditor's Attachments & Files section. See
// docs/operations-basecamp-feature.md Phase 6.

import { useCallback, useEffect, useRef, useState } from "react";

type Uploader = { id: string; full_name: string; username: string } | null;

interface ProjectFile {
  id: string;
  project_id: string;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_at: string;
  uploader: Uploader;
  url: string | null;
}

interface ProjectFilesProps {
  projectId: string;
  currentUserId: string;
  isAdmin: boolean;
}

function uploaderName(u: Uploader): string {
  return u?.full_name || u?.username || "Unknown";
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type FileTypeFilter = "all" | "image" | "document" | "spreadsheet" | "other";

const FILE_TYPE_OPTIONS: { key: FileTypeFilter; label: string }[] = [
  { key: "all", label: "All Files" },
  { key: "image", label: "Images" },
  { key: "document", label: "Documents" },
  { key: "spreadsheet", label: "Spreadsheets" },
  { key: "other", label: "Other" },
];

/** Buckets a file's mime type into one of the filter categories above —
 *  broad on purpose (e.g. any text/* counts as a Document) since this is a
 *  filter, not a precise classifier. */
function fileTypeOf(mime: string | null): Exclude<FileTypeFilter, "all"> {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet";
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word") || mime.includes("document")) {
    return "document";
  }
  return "other";
}

export default function ProjectFiles({ projectId, currentUserId, isAdmin }: ProjectFilesProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("all");

  const filteredFiles = files.filter((file) => {
    if (typeFilter !== "all" && fileTypeOf(file.mime_type) !== typeFilter) return false;
    if (search.trim() && !file.filename.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/project-files?projectId=${projectId}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setFiles(d.files ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const handleFilesPicked = async (picked: File[]) => {
    if (picked.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("project_id", projectId);
      for (const file of picked) formData.append("file", file);

      const res = await fetch("/api/project-files", { method: "POST", body: formData });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      void fetchFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    const previous = files;
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    try {
      const res = await fetch(`/api/project-files?id=${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setFiles(previous);
    }
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Docs &amp; Files</h3>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "+ Upload File"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            void handleFilesPicked(picked);
          }}
        />
      </div>

      {error && <p className="text-[11px] text-terracotta">{error}</p>}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {FILE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTypeFilter(opt.key)}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                  typeFilter === opt.key ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by filename…"
            className="ml-auto min-w-[140px] flex-1 rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          />
        </div>
      )}

      {loading ? (
        <p className="text-[12px] text-stone">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-[12px] text-stone/70">No files yet.</p>
      ) : filteredFiles.length === 0 ? (
        <p className="text-[12px] text-stone/70">No files match this filter.</p>
      ) : (
        <div className="space-y-1.5">
          {filteredFiles.map((file) => {
            const canDelete = isAdmin || file.uploaded_by === currentUserId;
            return (
              <div
                key={file.id}
                className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-sand bg-white"
              >
                <div className="min-w-0">
                  {file.url ? (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[13px] font-semibold text-terracotta hover:underline"
                    >
                      {file.filename}
                    </a>
                  ) : (
                    <span className="block truncate text-[13px] font-semibold text-espresso">{file.filename}</span>
                  )}
                  <p className="text-[10px] text-stone/80">
                    {uploaderName(file.uploader)} · {formatWhen(file.uploaded_at)}
                    {file.file_size != null && ` · ${formatFileSize(file.file_size)}`}
                  </p>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(file.id)}
                    className="shrink-0 text-[10px] font-semibold text-terracotta hover:text-terracotta/80"
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
