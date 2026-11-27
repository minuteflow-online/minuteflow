"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SessionBanner, { type SessionState } from "@/components/SessionBanner";
import type { ClientClockSession } from "@/types/database";

function greetingFor(timezone: string): string {
  const h = parseInt(
    new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", hour12: false }),
    10
  );
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// A client's own clock in/out, kept in a table of its own (client_clock_sessions)
// rather than the shared `sessions` table — the real dashboard/team/admin pages
// read `sessions` unfiltered to build their "who's clocked in" widgets, and a
// client's row would otherwise show up there as if they were a VA.
//
// Laid out like the staff dashboard's top: the greeting row doubles as the
// Clock In prompt while idle, and the timer bar appears above it once clocked in.
export default function ClientClockWidget({ fullName, orgName }: { fullName: string; orgName: string }) {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const clockInTimeRef = useRef<string | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    fetch("/api/client-admin/team-context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => {
        if (d?.timezone) setTimezone(d.timezone);
      })
      .catch(() => {});
  }, []);

  const applySession = useCallback((s: ClientClockSession | null) => {
    if (!s || !s.clocked_in) {
      setState("idle");
      setClockInTime(null);
      clockInTimeRef.current = null;
      return;
    }
    setState("clocked-in");
    setClockInTime(s.clock_in_time);
    clockInTimeRef.current = s.clock_in_time;
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("client_clock_sessions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      applySession(data as ClientClockSession | null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => {
      if (!clockInTimeRef.current) {
        setElapsedSeconds(0);
        return;
      }
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - new Date(clockInTimeRef.current).getTime()) / 1000))
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleClockIn = useCallback(async () => {
    if (!userId) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("client_clock_sessions").upsert(
      { user_id: userId, clocked_in: true, clock_in_time: now, clock_out_time: null, updated_at: now },
      { onConflict: "user_id" }
    );
    applySession({ user_id: userId, clocked_in: true, clock_in_time: now, clock_out_time: null, updated_at: now, id: 0 });
    setActionPending(false);
  }, [supabase, userId, applySession]);

  const handleClockOut = useCallback(async () => {
    if (!userId) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("client_clock_sessions").upsert(
      { user_id: userId, clocked_in: false, clock_out_time: now, updated_at: now },
      { onConflict: "user_id" }
    );
    applySession(null);
    setActionPending(false);
  }, [supabase, userId, applySession]);

  // Break isn't part of the client's clock-in — state never becomes "on-break",
  // so these are never actually invoked; SessionBanner just requires them.
  const noop = useCallback(() => {}, []);

  const firstName = fullName.split(" ")[0] || fullName;
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      {state !== "idle" && (
        <SessionBanner
          state={state}
          clockInTime={clockInTime}
          elapsedSeconds={elapsedSeconds}
          breakElapsedSeconds={0}
          actionPending={actionPending}
          hideBreak
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          onStartBreak={noop}
          onEndBreak={noop}
        />
      )}

      {/* Greeting — same as the staff dashboard's; doubles as the Clock In prompt when idle */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] font-normal text-espresso mb-1">
            {greetingFor(timezone)}, <strong className="font-bold">{firstName}</strong>
          </h1>
          <p className="text-sm text-bark">
            {today}
            {orgName ? <> &mdash; {orgName}</> : null}
          </p>
        </div>
        {state === "idle" && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              onClick={handleClockIn}
              disabled={actionPending || !userId}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#5a8a60] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(107,143,113,0.25)] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
              Clock In
            </button>
            <p className="text-[13px] italic text-stone">&ldquo;Let Every Minute Count With Purpose&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}
