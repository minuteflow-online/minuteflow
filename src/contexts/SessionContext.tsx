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

export type SessionActions = {
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
};

type SessionContextValue = {
  // State values
  sessionState: SessionState;
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
      setBreakStartTime(null);
      return;
    }
    if (s.clock_in_time) {
      setClockInTime(s.clock_in_time);
    }
    if ((s.active_task as { isBreak?: boolean } | null)?.isBreak) {
      setSessionState("on-break");
      const bt = (s.active_task as { start_time?: string }).start_time || null;
      setBreakStartTime(bt);
    } else {
      setSessionState("clocked-in");
      setBreakStartTime(null);
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

  // NOTE: sessionElapsed and breakElapsed have been intentionally removed from
  // context. They were causing every useSession() consumer to re-render every
  // second. The SessionBannerWrapper now maintains its own local timer for display.

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

  // Keep a ref to default actions so the stable wrapper can fall back without capturing stale closures
  const defaultActionsRef = useRef<SessionActions>(defaultActions);
  useEffect(() => { defaultActionsRef.current = defaultActions; });

  // Override actions (registered by dashboard on mount)
  // Use a ref — NOT state — so updating registered actions never triggers a provider re-render.
  // A state-based approach caused the entire provider (and all children) to re-render every
  // second because startBreak/endBreak depend on taskElapsed/breakElapsed timer states.
  const overrideActionsRef = useRef<SessionActions | null>(null);

  // Stable wrapper — same object reference forever, delegates to whatever is currently registered.
  const stableActions = useRef<SessionActions>({
    clockIn: (...args) => (overrideActionsRef.current ?? defaultActionsRef.current).clockIn(...args),
    clockOut: (...args) => (overrideActionsRef.current ?? defaultActionsRef.current).clockOut(...args),
    startBreak: (...args) => (overrideActionsRef.current ?? defaultActionsRef.current).startBreak(...args),
    endBreak: (...args) => (overrideActionsRef.current ?? defaultActionsRef.current).endBreak(...args),
  });

  const registerActions = useCallback((a: SessionActions): (() => void) => {
    overrideActionsRef.current = a;
    return () => { overrideActionsRef.current = null; };
  }, []);

  const actions = stableActions.current;

  return (
    <SessionContext.Provider
      value={{
        sessionState,
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
