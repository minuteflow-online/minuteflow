"use client";

import { useEffect, useMemo, useState } from "react";

interface ScreenshotLightboxProps {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

export default function ScreenshotLightbox({
  urls,
  initialIndex,
  onClose,
}: ScreenshotLightboxProps) {
  const safeUrls = useMemo(() => urls.filter(Boolean), [urls]);
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
        {showArrows && (
          <div className="text-sm font-medium text-white/80">
            {currentIndex + 1} / {safeUrls.length}
          </div>
        )}
      </div>
    </div>
  );
}
