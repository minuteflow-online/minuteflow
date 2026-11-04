"use client";

import { useEffect, useState } from "react";

/**
 * Shows a PDF in place instead of sending the viewer to a new tab. The bytes
 * are fetched and re-wrapped as application/pdf so the browser's own viewer
 * renders them even when storage serves the file under a generic
 * content-type (which is what made it download or open blank before).
 * Same modal shell as SubmissionAttachmentGallery's HTML preview.
 */
export default function PdfPreviewModal({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // The parent unmounts this modal on close, so it only loads once per mount.
    let cancelled = false;
    let created: string | null = null;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the file (${res.status}).`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setBlobUrl(created);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the file.");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sand px-4 py-2.5">
          <span className="truncate text-[12px] font-semibold text-espresso">{filename}</span>
          <div className="flex items-center gap-3">
            <a
              href={url}
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
          ) : blobUrl === null ? (
            <p className="p-4 text-[12px] text-stone">Loading preview...</p>
          ) : (
            <iframe title={filename} src={blobUrl} className="h-full w-full border-0 bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
