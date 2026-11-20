"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SessionBanner, { type SessionState } from "@/components/SessionBanner";
import type { ClientClockSession } from "@/types/database";

// A client's own clock in/out, kept in a table of its own (client_clock_sessions)
// rather than the shared `sessions` table — the real dashboard/team/admin pages
// read `sessions` unfiltered to build their "who's clocked in" widgets, and a
// client's row would otherwise show up there as if they were a VA.
export default function ClientClockWidget() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const clockInTimeRef = useRef<string | null>(null);

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

  return (
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
  );
}
