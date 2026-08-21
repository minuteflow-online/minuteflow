"use client";

import { useEffect, useMemo, useState } from "react";

interface ScreenshotLightboxProps {
  urls: string[];
  initialIndex: number;
  /** Optional label per URL, same order and length — shown under the image. Used
   *  to say when a screenshot was taken, which the thumbnail grid shows but the
   *  expanded view otherwise loses. */
  captions?: string[];
  onClose: () => void;
}

export default function ScreenshotLightbox({
  urls,
  initialIndex,
  captions,
  onClose,
}: ScreenshotLightboxProps) {
  // urls and captions are filtered together so an empty url can never shift a
  // caption onto the wrong image.
  const shots = useMemo(
    () =>
      urls
        .map((url, i) => ({ url, caption: captions?.[i] }))
        .filter((s) => Boolean(s.url)),
    [urls, captions]
  );
  const safeUrls = useMemo(() => shots.map((s) => s.url), [shots]);
  const [currentIndex, setCurrentIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(safeUrls.length - 1, 0)));
  const currentUrl = safeUrls[currentIndex] ?? safeUrls[0] ?? "";
  const showArrows = safeUrls.length > 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!showArrows) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((index) => Math.max(0, index - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((index) => Math.min(safeUrls.length - 1, index + 1));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, safeUrls.length, showArrows]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl font-bold z-10 transition-colors"
      >
        &times;
      </button>

      {showArrows && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex((index) => Math.max(0, index - 1));
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-bold z-10 transition-colors"
            aria-label="Previous screenshot"
          >
            &#8249;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex((index) => Math.min(safeUrls.length - 1, index + 1));
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-bold z-10 transition-colors"
            aria-label="Next screenshot"
          >
            &#8250;
          </button>
        </>
      )}

      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={currentUrl}
          alt="Screenshot"
          className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
        />
        {(shots[currentIndex]?.caption || showArrows) && (
          <div className="flex items-center gap-3 text-sm font-medium text-white/80">
            {shots[currentIndex]?.caption && <span>{shots[currentIndex].caption}</span>}
            {showArrows && (
              <span className="text-white/60">
                {currentIndex + 1} / {safeUrls.length}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
