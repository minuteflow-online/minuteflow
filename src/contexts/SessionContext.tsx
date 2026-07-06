"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { SessionState } from "@/components/SessionBanner";
import type { Session } from "@/types/database";

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

export type SessionActions = {
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
};

type SessionContextValue = {
  // State values
  sessionState: SessionState;
  sessionElapsed: number;
  breakElapsed: number;
  clockInTime: string | null;
  breakStartTime: string | null;
  userId: string | null;
  orgTimezone: string;
  actionPending: boolean;

  // Setters for dashboard optimistic updates
  setSessionState: (s: SessionState) => void;
  setBreakStartTime: (t: string | null) => void;
  setActionPending: (p: boolean) => void;

  // Re-fetch session from DB
  refresh: () => Promise<void>;

  // Action registration — dashboard overrides simple defaults
  registerActions: (a: SessionActions) => () => void;
  actions: SessionActions;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const [breakStartTime, setBreakStartTime] = useState<string | null>(null);
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [actionPending, setActionPending] = useState(false);

  // Refs so interval callbacks always read current values
  const clockInTimeRef = useRef<string | null>(null);
  const breakStartTimeRef = useRef<string | null>(null);
  const sessionStateRef = useRef<SessionState>("idle");

  useEffect(() => { clockInTimeRef.current = clockInTime; }, [clockInTime]);
  useEffect(() => { breakStartTimeRef.current = breakStartTime; }, [breakStartTime]);
  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);

  const userIdRef = useRef<string | null>(null);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const applySession = useCallback((s: Session | null) => {
    if (!s || !s.clocked_in) {
      setSessionState("idle");
      setClockInTime(null);
      setSessionElapsed(0);
      setBreakElapsed(0);
      setBreakStartTime(null);
      return;
    }
    if (s.clock_in_time) {
      setClockInTime(s.clock_in_time);
      setSessionElapsed(secondsSince(s.clock_in_time));
    }
    if ((s.active_task as { isBreak?: boolean } | null)?.isBreak) {
      setSessionState("on-break");
      const bt = (s.active_task as { start_time?: string }).start_time || null;
      setBreakStartTime(bt);
      if (bt) setBreakElapsed(secondsSince(bt));
    } else {
      setSessionState("clocked-in");
      setBreakStartTime(null);
      setBreakElapsed(0);
    }
  }, []);

  const refresh = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    applySession(data as Session | null);
  }, [supabase, applySession]);

  // Init: get user, session, org timezone
  useEffect(() => {
    const sb = createClient();
    async function init() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      userIdRef.current = user.id;

      const [sessionRes, orgRes] = await Promise.all([
        sb.from("sessions").select("*").eq("user_id", user.id).maybeSingle(),
        sb.from("organization_settings").select("timezone").limit(1).single(),
      ]);

      if (orgRes.data?.timezone) setOrgTimezone(orgRes.data.timezone);
      applySession(sessionRes.data as Session | null);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer — ticks every second while clocked in or on break
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (sessionState === "idle") return;

    timerRef.current = setInterval(() => {
      if (clockInTimeRef.current) {
        setSessionElapsed(secondsSince(clockInTimeRef.current));
      }
      if (sessionStateRef.current === "on-break" && breakStartTimeRef.current) {
        setBreakElapsed(secondsSince(breakStartTimeRef.current));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionState]);

  // Simple default actions (used on non-dashboard pages)
  const defaultClockIn = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("sessions").upsert(
      { user_id: uid, clocked_in: true, clock_in_time: now, updated_at: now },
      { onConflict: "user_id" }
    );
    await refresh();
    setActionPending(false);
  }, [supabase, refresh]);

  const defaultClockOut = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("sessions").upsert(
      {
        user_id: uid,
        clocked_in: false,
        clock_out_time: now,
        active_task: null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );
    await refresh();
    setActionPending(false);
  }, [supabase, refresh]);

  const defaultStartBreak = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("sessions").update(
      { active_task: { isBreak: true, start_time: now }, updated_at: now }
    ).eq("user_id", uid);
    await refresh();
    setActionPending(false);
  }, [supabase, refresh]);

  const defaultEndBreak = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setActionPending(true);
    const now = new Date().toISOString();
    await supabase.from("sessions").update(
      { active_task: null, updated_at: now }
    ).eq("user_id", uid);
    await refresh();
    setActionPending(false);
  }, [supabase, refresh]);

  const defaultActions: SessionActions = {
    clockIn: defaultClockIn,
    clockOut: defaultClockOut,
    startBreak: defaultStartBreak,
    endBreak: defaultEndBreak,
  };

  // Override actions (registered by dashboard on mount)
  const [overrideActions, setOverrideActions] = useState<SessionActions | null>(null);

  const registerActions = useCallback((a: SessionActions): (() => void) => {
    setOverrideActions(a);
    return () => setOverrideActions(null);
  }, []);

  const actions = overrideActions ?? defaultActions;

  return (
    <SessionContext.Provider
      value={{
        sessionState,
        sessionElapsed,
        breakElapsed,
        clockInTime,
        breakStartTime,
        userId,
        orgTimezone,
        actionPending,
        setSessionState,
        setBreakStartTime,
        setActionPending,
        refresh,
        registerActions,
        actions,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
