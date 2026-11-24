"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/actions/auth";
import NotificationBell from "@/components/NotificationBell";
import AvatarUpload from "@/components/AvatarUpload";
import ReportIssueModal, { BugIcon } from "@/components/ReportIssueModal";
import { getTimezoneAbbr } from "@/lib/utils";

/*
 * The client area's top bar — a copy of the staff TopNav's look (same
 * sticky white bar, brand with the clock under it, tab pills, Report Bug,
 * name chip with photo and a Log out menu, bell), wired to the client's own
 * pages. Kept separate from TopNav because that one carries staff-only
 * behaviour (clock-out wizard, active-task checks) and staff links.
 */

const NAV_ITEMS: { label: string; href: string; exact?: boolean }[] = [
  { label: "Dashboard", href: "/client", exact: true },
  { label: "Productivity", href: "/client/productivity" },
  { label: "Insights", href: "/client/insights" },
  { label: "Portal", href: "/client/portal" },
  { label: "Admin", href: "/client/admin" },
];

/** Same clock as TopNav's, using the timezone the client's routes report. */
function Clock() {
  const [timezone, setTimezone] = useState("UTC");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => {
    fetch("/api/client-admin/team-context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => {
        if (d?.timezone) setTimezone(d.timezone);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const abbr = getTimezoneAbbr(timezone);
    function updateClock() {
      const now = new Date();
      setDate(now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }));
      setTime(
        now.toLocaleTimeString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) +
          " " +
          abbr
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  if (!time) return null;

  return (
    <div className="flex flex-col leading-none">
      <span className="font-serif text-[10px] leading-tight text-stone">{date}</span>
      <span className="font-serif text-[11px] leading-none text-bark tabular-nums">{time}</span>
    </div>
  );
}

function DoorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ClientTopNav({
  fullName,
  avatarUrl: initialAvatarUrl,
  roleLabel,
}: {
  fullName: string;
  avatarUrl: string | null;
  roleLabel: string;
}) {
  const pathname = usePathname() ?? "";
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-sand bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          {/* Left: Brand, with the clock tucked underneath it */}
          <div className="flex flex-col items-start gap-0.5">
            <Link href="/client" className="flex items-center gap-1">
              <span className="font-serif text-xl font-bold leading-none text-ink">
                Minute
                <span className="italic text-terracotta">Flow</span>
              </span>
            </Link>
            <Clock />
          </div>

          {/* Center: Tab navigation */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-terracotta-soft text-terracotta" : "text-bark hover:bg-parchment hover:text-espresso"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: Report button, user chip (dropdown: log out), bell */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              title="Report a bug or request a feature"
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-terracotta/30 bg-terracotta-soft px-3 py-1.5 text-[11px] font-semibold text-terracotta transition-colors hover:bg-terracotta hover:text-white"
            >
              <BugIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Report Bug / Idea</span>
            </button>

            <div className="relative flex items-center gap-2 rounded-full bg-parchment py-1 pl-1 pr-3">
              <AvatarUpload avatarUrl={avatarUrl} fullName={fullName} size={28} onUploaded={setAvatarUrl} />
              <button
                type="button"
                onClick={() => setShowUserMenu((o) => !o)}
                className="flex cursor-pointer items-center gap-1.5"
              >
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-medium text-espresso leading-tight">{fullName}</p>
                  <p className="text-[10px] text-bark leading-tight">{roleLabel}</p>
                </div>
                <DoorIcon className="h-3.5 w-3.5 shrink-0 text-bark" />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-sand bg-white py-1 shadow-lg">
                    <form action={signOut}>
                      <button
                        type="submit"
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] text-espresso transition-colors hover:bg-parchment"
                      >
                        <DoorIcon className="h-4 w-4 text-bark" />
                        Log out
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>

            <NotificationBell />
          </div>
        </div>
      </header>

      <ReportIssueModal open={showReportModal} onClose={() => setShowReportModal(false)} />
    </>
  );
}
