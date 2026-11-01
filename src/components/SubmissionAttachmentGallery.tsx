"use client";

import { useEffect, useState } from "react";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import type { TaskSubmissionAttachment } from "@/lib/submissions";

/**
 * Images become a thumbnail strip that opens full size in a lightbox.
 * Everything else is a link — plus a Preview button for an HTML file:
 * Supabase deliberately serves an uploaded .html file as text/plain when it's
 * opened directly (a platform-wide security measure against stored-page
 * abuse, not something fixable at upload — see the Sept 2026 boss report).
 * Preview re-fetches the same bytes with fetch(), which reads the body as
 * text regardless of what content-type the response claims, and renders them
 * in a fully sandboxed iframe — no scripts, no same-origin, no forms — so
 * showing exactly what a VA uploaded is safe even before anyone's reviewed it.
 */
export default function SubmissionAttachmentGallery({ attachments }: { attachments: TaskSubmissionAttachment[] }) {
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [previewFile, setPreviewFile] = useState<TaskSubmissionAttachment | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((f) => (f.mime_type ?? "").startsWith("image/") && f.url);
  const others = attachments.filter((f) => !images.includes(f));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((file, i) => (
            <button
              key={file.id}
              type="button"
              onClick={() =>
                setLightbox({ urls: images.map((f) => f.url as string), index: i })
              }
              title={file.filename}
              className="shrink-0 overflow-hidden rounded border border-sand transition-all hover:border-terracotta"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={file.url as string}
                alt={file.filename}
                loading="lazy"
                className="h-[72px] w-[96px] object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((file) => {
            const isHtml =
              (file.mime_type ?? "").includes("html") || /\.html?$/i.test(file.filename);
            return (
              <span key={file.id} className="inline-flex items-center gap-1">
                <a
                  href={file.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-sand bg-cream/40 px-2 py-1 text-[11px] text-terracotta hover:bg-cream"
                >
                  {file.filename}
                </a>
                {isHtml && file.url && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] font-semibold text-espresso transition-colors hover:bg-cream"
                  >
                    Preview
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {lightbox && (
        <ScreenshotLightbox
          urls={lightbox.urls}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {previewFile && <HtmlPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}

/** Fetches an attachment's bytes (bypassing whatever content-type the
 *  storage response claims) and renders them in a fully sandboxed iframe —
 *  scripts, forms, and same-origin access are all disabled, so this is safe
 *  to open on a file nobody's reviewed yet. */
function HtmlPreviewModal({
  file,
  onClose,
}: {
  file: TaskSubmissionAttachment;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only ever runs once per mount — the parent unmounts this modal on
    // close, so there's no case where `file` changes under a mounted
    // instance and the initial useState values need resetting here.
    let cancelled = false;
    fetch(file.url as string)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the file (${res.status}).`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the file.");
      });
    return () => {
      cancelled = true;
    };
  }, [file.url]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sand px-4 py-2.5">
          <span className="truncate text-[12px] font-semibold text-espresso">{file.filename}</span>
          <div className="flex items-center gap-3">
            <a
              href={file.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold text-terracotta hover:underline"
            >
              Download
            </a>
            <button
              onClick={onClose}
              className="text-stone hover:text-espresso"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 bg-cream/40">
          {error ? (
            <p className="p-4 text-[12px] text-terracotta">{error}</p>
          ) : html === null ? (
            <p className="p-4 text-[12px] text-stone">Loading preview...</p>
          ) : (
            <iframe
              title={file.filename}
              srcDoc={html}
              sandbox=""
              className="h-full w-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
