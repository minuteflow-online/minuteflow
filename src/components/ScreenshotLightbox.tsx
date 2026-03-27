"use client";

import { useEffect } from "react";

interface ScreenshotLightboxProps {
  url: string;
  onClose: () => void;
}

export default function ScreenshotLightbox({
  url,
  onClose,
}: ScreenshotLightboxProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      <img
        src={url}
        alt="Screenshot"
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
