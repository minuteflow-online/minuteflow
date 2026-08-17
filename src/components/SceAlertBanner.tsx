"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useScreenCaptureCtx } from "@/contexts/ScreenCaptureProvider";
import { EXTENSION_MIN_VERSION } from "@/lib/extensionVersion";

type BannerReason = "screenshare" | "sce" | "sce-login";

/**
 * Global SCE alert banner — shown on all (app) pages except /dashboard.
 * The dashboard has its own banner with full screen-capture machinery.
 * This component polls Supabase every 2 minutes; when the VA is clocked in
 * and the SCE extension heartbeat is stale, it surfaces the amber warning.
 * "Reshare Now" navigates back to /dashboard where the actual stream
 * request and screenshot scheduling live.
 */
export default function SceAlertBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { isActive: screenShareActive } = useScreenCaptureCtx();

  const [show, setShow] = useState(false);
  const [reason, setReason] = useState<BannerReason>("screenshare");
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Version of the extension this VA is actually running, when it's behind.
  const [outdatedVersion, setOutdatedVersion] = useState<string | null>(null);

  // Skip on dashboard — it renders its own banner with full capture logic
  const isDashboard = pathname === "/dashboard";

  // Resolve current user once
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        userIdRef.current = data.user.id;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const DISMISS_KEY = "sce_banner_dismissed_until";
  const DISMISS_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  const isDismissed = () => {
    try {
      const until = sessionStorage.getItem(DISMISS_KEY);
      if (!until) return false;
      return Date.now() < parseInt(until, 10);
    } catch {
      return false;
    }
  };

  // Updating means reinstalling by hand, so "Later" holds for the rest of the
  // browser session rather than the 30 minutes the SCE warning uses — nagging
  // every half hour about a task they can't do in one click is just noise.
  const VERSION_DISMISS_KEY = "extension_version_banner_dismissed_until";
  const VERSION_DISMISS_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

  const isVersionDismissed = () => {
    try {
      const until = sessionStorage.getItem(VERSION_DISMISS_KEY);
      if (!until) return false;
      return Date.now() < parseInt(until, 10);
    } catch {
      return false;
    }
  };

  const checkSce = async (uid: string) => {
    // If the user dismissed within the last 30 min, don't re-show on navigation
    if (isDismissed()) return;

    // Is the VA currently clocked in?
    const { data: session } = await supabase
      .from("sessions")
      .select("clocked_in")
      .eq("user_id", uid)
      .maybeSingle();

    if (!session?.clocked_in) {
      setShow(false);
      return;
    }

    // Is the SCE extension heartbeat stale (> 5 min)?
    const { data: hb } = await supabase
      .from("extension_heartbeats")
      .select("last_seen")
      .eq("user_id", uid)
      .maybeSingle();

    const staleMs =
      hb?.last_seen
        ? Date.now() - new Date(hb.last_seen).getTime()
        : Infinity;

    if (staleMs > 5 * 60 * 1000) {
      setReason(hb?.last_seen ? "sce" : "sce-login");
      setShow(true);
    } else {
      setShow(false);
    }
  };

  // Run check on load and every 2 minutes.
  // Does NOT re-run on route changes — navigation alone should not re-trigger the banner.
  // Suppressed entirely when the web-app screen share stream is active.
  useEffect(() => {
    if (!userId || isDashboard || screenShareActive) {
      setShow(false);
      return;
    }

    checkSce(userId);
    const interval = setInterval(() => checkSce(userId), 2 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isDashboard, screenShareActive]);

  // Which extension build this VA is on. Hourly is plenty — the answer only
  // changes when they reinstall, and the route reads a table they can't query
  // directly (extension_upload_status is admin-only under RLS).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const res = await fetch("/api/extension-version");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setOutdatedVersion(data.outdated ? data.version : null);
      } catch {
        // Offline or route unavailable — leave the banner alone rather than
        // guessing that a VA is out of date.
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  // Outdated-extension notice. Unlike the SCE warnings this also shows on the
  // dashboard: the dashboard's own banner covers screen-share and heartbeat
  // trouble, not which build the VA is running, and the dashboard is where they
  // spend the day. Suppressed while an SCE warning is up so the two never stack.
  if (outdatedVersion && !show && !isVersionDismissed()) {
    return (
      <div className="fixed top-14 left-0 right-0 z-[60] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2.5 shadow-md">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>
            Your screen capture extension is out of date (v{outdatedVersion} — current is v
            {EXTENSION_MIN_VERSION}). Please update to keep your screenshots accurate.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => router.push("/install")}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
          >
            Update Now
          </button>
          <button
            onClick={() => {
              try {
                sessionStorage.setItem(
                  VERSION_DISMISS_KEY,
                  String(Date.now() + VERSION_DISMISS_DURATION_MS)
                );
              } catch { /* ignore */ }
              setOutdatedVersion(null);
            }}
            className="px-2 py-1 text-xs text-white/80 transition-colors hover:text-white"
          >
            Later
          </button>
        </div>
      </div>
    );
  }

  if (!show || isDashboard) return null;

  return (
    <div className="fixed top-14 left-0 right-0 z-[60] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2.5 shadow-md">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          {reason === "sce-login"
            ? "⚠️ SCE not connected — please log in to your extension to enable screenshots."
            : reason === "sce"
            ? "📷 Screenshots paused — your extension went offline. Reshare your screen to keep capturing."
            : "Your screen share stopped. Please reshare to continue tracking."}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
        >
          Reshare Now
        </button>
        <button
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
            } catch { /* ignore */ }
            setShow(false);
          }}
          className="px-2 py-1 text-xs text-white/80 transition-colors hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
