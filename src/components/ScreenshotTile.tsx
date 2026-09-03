import type { TaskScreenshot } from "@/types/database";

/**
 * The content of one screenshot slot in a log row — a real image, or, for a
 * marker (screenshot_type "failed"), a visible explanation instead of a blank
 * "..." box that looks identical to "still loading" and forever stays that way.
 *
 * A marker never has an image (drive_file_id is always null for one), so it
 * used to render the same placeholder as a screenshot mid-upload — from a
 * reviewer's seat, an explained gap and a broken capture looked the same.
 */
export function ScreenshotTile({ ss, url }: { ss: TaskScreenshot; url?: string }) {
  if (url) {
    return <img src={url} alt="" className="w-full h-full object-cover" />;
  }

  if (ss.screenshot_type === "failed") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-amber-soft">
        <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2 11l3.5-3.5a1 1 0 0 1 1.4 0L9 9.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // Not a marker, no URL yet — a real screenshot still resolving its signed URL.
  return <div className="w-full h-full flex items-center justify-center text-[7px] text-stone">...</div>;
}
