"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration, getInitials, getAvatarColor } from "@/lib/utils";

interface Member {
  profile: { id: string; full_name: string };
  status: "live" | "personal" | "break" | "off";
  currentTask: string;
  /** True only while the VA is on one of this org's own tasks. */
  workingForOrg?: boolean;
  latestScreenshot: { id: number; url: string; createdAt: string } | null;
  todayHoursMs: number;
  todayTasks: number;
  todayScreenshots: number;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function MemberCard({
  member,
  onCaptureNow,
  onForceClockOut,
}: {
  member: Member;
  onCaptureNow: (id: string) => Promise<void>;
  onForceClockOut: (id: string) => Promise<void>;
}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isForcing, setIsForcing] = useState(false);
  // On-page confirm instead of window.confirm(), which some browsers and
  // embedded views silently cancel — the button then looks dead.
  const [confirmForce, setConfirmForce] = useState(false);
  const prevShotId = useRef<number | undefined>(undefined);

  useEffect(() => {
    const newId = member.latestScreenshot?.id;
    if (prevShotId.current !== undefined && newId !== prevShotId.current) setIsCapturing(false);
    prevShotId.current = newId;
  }, [member.latestScreenshot?.id]);

  const { profile, status, currentTask, latestScreenshot, todayHoursMs, todayTasks, todayScreenshots } = member;
  const avatarColor = getAvatarColor(profile.id);
  const isOffline = status === "off";

  const statusConfig = {
    live: { label: "Live", bg: "bg-sage-soft", text: "text-sage", dot: "bg-sage" },
    personal: { label: "Personal", bg: "bg-clay-rose-soft", text: "text-clay-rose", dot: "bg-clay-rose" },
    break: { label: "Break", bg: "bg-amber-soft", text: "text-amber", dot: "bg-amber" },
    off: { label: "Offline", bg: "bg-parchment", text: "text-stone", dot: "bg-stone" },
  }[status];

  return (
    <div className={`overflow-hidden rounded-xl border border-sand bg-white transition-all hover:shadow-md ${isOffline ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2.5 border-b border-parchment px-4 py-3">
        <div className="relative">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {getInitials(profile.full_name)}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${statusConfig.dot}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-bold text-espresso">{profile.full_name}</span>
            <span className={`shrink-0 rounded-full px-2 py-[2px] text-[9px] font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
              {statusConfig.label}
            </span>
          </div>
          <div className="truncate text-[11px] text-bark">{currentTask}</div>
        </div>
      </div>

      <div className="relative aspect-video w-full overflow-hidden bg-parchment">
        {latestScreenshot ? (
          <img src={latestScreenshot.url} alt={`Latest screenshot from ${profile.full_name}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-stone">
            <svg className="h-6 w-6 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
            <span className="text-[10px]">{isOffline ? "No screenshots today" : "No captures yet"}</span>
          </div>
        )}
        {latestScreenshot && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/50 px-2 py-0.5 text-[9px] font-semibold text-white">
            {timeAgo(latestScreenshot.createdAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 border-b border-parchment px-4 py-2">
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="font-semibold text-sage">{formatDuration(todayHoursMs)}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span>{todayTasks} tasks</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>{todayScreenshots} ss</span>
        </div>
      </div>

      {!isOffline && member.workingForOrg && (
        <div className="flex flex-wrap gap-1.5 p-2.5">
          <button
            onClick={async () => {
              setIsCapturing(true);
              await onCaptureNow(profile.id);
              setTimeout(() => setIsCapturing(false), 20000);
            }}
            disabled={isCapturing}
            className="flex-1 rounded-md bg-terracotta py-1.5 text-center text-[11px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCapturing ? "Requesting…" : "Capture Now"}
          </button>
          {confirmForce ? (
            <div className="w-full space-y-1.5 rounded-md bg-terracotta-soft px-2.5 py-2">
              <p className="text-[11px] text-terracotta">Clock them out now? Any task they&apos;re running will be closed.</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setConfirmForce(false)}
                  disabled={isForcing}
                  className="flex-1 rounded-md bg-stone/10 py-1.5 text-center text-[11px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setIsForcing(true);
                    await onForceClockOut(profile.id);
                    setIsForcing(false);
                    setConfirmForce(false);
                  }}
                  disabled={isForcing}
                  className="flex-1 rounded-md bg-terracotta py-1.5 text-center text-[11px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:opacity-60"
                >
                  {isForcing ? "Clocking out…" : "Yes, clock out"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmForce(true)}
              className="w-full rounded-md border border-terracotta/30 bg-terracotta-soft py-1.5 text-center text-[11px] font-semibold text-terracotta transition-all hover:bg-terracotta hover:text-white"
            >
              Force Clock Out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClientLiveTeamMonitor() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/client-admin/team-monitor");
    if (!res.ok) return;
    const data = await res.json();
    setMembers(data.members ?? []);
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCaptureNow = useCallback(
    async (targetUserId: string) => {
      await fetch("/api/client-admin/capture-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      fetchData();
    },
    [fetchData]
  );

  const handleForceClockOut = useCallback(
    async (targetUserId: string) => {
      await fetch("/api/client-admin/force-clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      fetchData();
    },
    [fetchData]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="mt-1 text-xs text-stone">Invite a VA to start monitoring them here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {members.map((m) => (
        <MemberCard key={m.profile.id} member={m} onCaptureNow={handleCaptureNow} onForceClockOut={handleForceClockOut} />
      ))}
    </div>
  );
}
