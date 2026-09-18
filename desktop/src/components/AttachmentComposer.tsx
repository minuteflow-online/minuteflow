// Ported from src/components/AttachmentComposer.tsx — same UI, same
// behavior (file picker, drag/drop, paste, a link field), just pointed at
// API_BASE with a bearer token instead of a relative fetch (this app has no
// browser cookies — see lib/db.ts). Backs onto the same /api/message-attachments
// route and message_attachments table as the web app, so an attachment sent
// from here shows up there and vice versa.
import { useCallback, useRef, useState, useMemo } from "react";
import { ensureAuth } from "../lib/db";
import { API_BASE } from "../lib/config";

export type AttachmentTargetType = "project_message" | "project_message_comment" | "direct_message";

export type Attachment = {
  id: string;
  kind: "file" | "link";
  filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  url: string | null;
  signedUrl: string | null;
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Files and links already attached to a topic, reply, or DM — same rule as
 *  web: an image shows itself rather than a filename chip. */
export function AttachmentList({ attachments }: { attachments?: Attachment[] }) {
  const list = attachments ?? [];
  if (list.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-start gap-1.5">
      {list.map((a) => {
        if (a.kind === "file" && a.mime_type?.startsWith("image/") && a.signedUrl) {
          return (
            <a key={a.id} href={a.signedUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img
                src={a.signedUrl}
                alt={a.filename ?? "Attached image"}
                className="max-h-40 max-w-full rounded-lg border border-sand object-cover"
              />
            </a>
          );
        }
        return a.kind === "link" ? (
          <a
            key={a.id}
            href={a.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-blue/30 bg-slate-blue-soft px-2 py-[2px] text-[10px] font-semibold text-slate-blue hover:underline"
          >
            <span className="truncate">🔗 {a.url}</span>
          </a>
        ) : (
          <a
            key={a.id}
            href={a.signedUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-sand bg-white px-2 py-[2px] text-[10px] font-semibold text-espresso hover:bg-cream"
          >
            <span className="truncate">📎 {a.filename}</span>
            {a.file_size != null && <span className="shrink-0 text-stone">{formatBytes(a.file_size)}</span>}
          </a>
        );
      })}
    </div>
  );
}

/** Files (paste, drag, or the button) and a link, held locally until the
 *  topic/reply/DM they belong to actually exists. */
export function useAttachmentComposer() {
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const addFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  }, []);
  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const reset = useCallback(() => {
    setFiles([]);
    setLink("");
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      addFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [addFiles]
  );
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const fromFiles = Array.from(e.clipboardData?.files ?? []);
      const fromItems = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      const picked = fromFiles.length > 0 ? fromFiles : fromItems;
      if (picked.length === 0) return;
      e.preventDefault();
      addFiles(picked);
    },
    [addFiles]
  );

  /** Uploads every pending file and the link (if any) against a now-real
   *  target — same best-effort-per-item reasoning as web's flush(). */
  const flush = useCallback(
    async (targetType: AttachmentTargetType, targetId: string | number) => {
      const session = await ensureAuth();
      if (!session) {
        reset();
        return;
      }
      const auth = `Bearer ${session.access_token}`;

      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("targetType", targetType);
        form.append("targetId", String(targetId));
        await fetch(`${API_BASE}/api/message-attachments`, {
          method: "POST",
          headers: { Authorization: auth },
          body: form,
        }).catch(() => {});
      }
      if (link.trim()) {
        await fetch(`${API_BASE}/api/message-attachments`, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId: String(targetId), kind: "link", url: link.trim() }),
        }).catch(() => {});
      }
      reset();
    },
    [files, link, reset]
  );

  const hasAttachment = files.length > 0 || link.trim().length > 0;
  const fallbackBody = useMemo(() => {
    if (files.length > 0 && link.trim()) return "📎 Sent an attachment and a link";
    if (files.length > 0) return files.length === 1 ? "📎 Sent an attachment" : `📎 Sent ${files.length} attachments`;
    if (link.trim()) return "🔗 Shared a link";
    return "";
  }, [files, link]);

  return { files, link, setLink, dragActive, hasAttachment, fallbackBody, addFiles, removeFile, reset, flush, onDragEnter, onDragLeave, onDragOver, onDrop, onPaste };
}

/** The attach button, drop zone, link field, and pending-file list for one composer. */
export function AttachmentPicker({
  composer,
  disabled,
}: {
  composer: ReturnType<typeof useAttachmentComposer>;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragEnter={composer.onDragEnter}
      onDragLeave={composer.onDragLeave}
      onDragOver={composer.onDragOver}
      onDrop={composer.onDrop}
      onPaste={composer.onPaste}
      className={`space-y-1.5 rounded-lg border p-1.5 transition-colors ${
        composer.dragActive ? "border-terracotta bg-terracotta-soft/20" : "border-dashed border-sand"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 px-2 py-0.5 rounded-lg bg-stone/10 text-stone text-[10px] font-semibold hover:bg-stone/20 disabled:opacity-50 cursor-pointer"
        >
          + Attach
        </button>
        <span className="truncate text-[10px] text-stone/70">or drag / paste files here</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            composer.addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <input
        value={composer.link}
        onChange={(e) => composer.setLink(e.target.value)}
        disabled={disabled}
        placeholder="Add a link (https://...)"
        className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
      />
      {composer.files.length > 0 && (
        <div className="space-y-1">
          {composer.files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-0.5">
              <span className="truncate text-[11px] text-espresso">{f.name}</span>
              <button
                type="button"
                onClick={() => composer.removeFile(i)}
                className="shrink-0 text-[10px] font-semibold text-terracotta hover:underline cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
