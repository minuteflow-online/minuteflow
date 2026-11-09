"use client";

import { useEffect, useMemo, useState } from "react";
import ScreenshotViewerFrame, { type ViewerLog, type ViewerPerson } from "@/components/ScreenshotViewerFrame";
import { useOrgTimezone } from "@/hooks/useOrgTimezone";
import type { ReportShot } from "@/lib/screenshotReport";

interface ScreenshotLightboxProps {
  urls: string[];
  initialIndex: number;
  /** Optional label per URL, same order and length — shown under the image. Used
   *  to say when a screenshot was taken, which the thumbnail grid shows but the
   *  expanded view otherwise loses. */
  captions?: string[];
  onClose: () => void;
}

type ShotMeta = { screenshot: ReportShot; person: ViewerPerson | null; log: ViewerLog | null };

/** Every screenshot image is served as /api/drive-image?id=<drive_file_id>. */
function driveIdOf(url: string): string | null {
  if (!url.includes("/api/drive-image")) return null;
  try {
    return new URL(url, "http://local").searchParams.get("id");
  } catch {
    return null;
  }
}

/**
 * The full-size viewer every page opens images in. A task screenshot gets the
 * Admin Screenshot Report viewer — who, which task, capture type, when, and the
 * task/account/client/category footer — looked up from its Drive id, so the
 * pages that open it don't have to carry any of that. Anything else (an
 * uploaded attachment, a bug-report capture) shows as a plain image.
 */
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
        .map((url, i) => ({ url, caption: captions?.[i], driveId: driveIdOf(url) }))
        .filter((s) => Boolean(s.url)),
    [urls, captions]
  );
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(shots.length - 1, 0))
  );
  const [meta, setMeta] = useState<Record<string, ShotMeta>>({});
  // Org time, same as Admin's viewer — never the viewer's own clock.
  const timezone = useOrgTimezone();

  const driveIdKey = useMemo(
    () => Array.from(new Set(shots.map((s) => s.driveId).filter((v): v is string => Boolean(v)))).join(","),
    [shots]
  );

  useEffect(() => {
    if (!driveIdKey) return;
    let cancelled = false;
    fetch(`/api/screenshots/meta?driveIds=${encodeURIComponent(driveIdKey)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { shots: {} }))
      .then((d) => {
        if (!cancelled) setMeta(d.shots ?? {});
      })
      .catch(() => {
        /* the image still shows; only the details around it are missing */
      });
    return () => {
      cancelled = true;
    };
  }, [driveIdKey]);

  const current = shots[currentIndex] ?? shots[0];
  if (!current) return null;
  const details = current.driveId ? meta[current.driveId] : undefined;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < shots.length - 1;

  return (
    <ScreenshotViewerFrame
      screenshot={details?.screenshot ?? null}
      url={current.url}
      person={details?.person ?? null}
      log={details?.log ?? null}
      timezone={timezone}
      caption={current.caption}
      position={{ index: currentIndex, count: shots.length }}
      onClose={onClose}
      onPrev={canPrev ? () => setCurrentIndex((i) => Math.max(0, i - 1)) : undefined}
      onNext={canNext ? () => setCurrentIndex((i) => Math.min(shots.length - 1, i + 1)) : undefined}
    />
  );
}
