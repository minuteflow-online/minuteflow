"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "@/contexts/SessionContext";
import { useScreenCaptureCtx } from "@/contexts/ScreenCaptureProvider";
import SessionBanner from "@/components/SessionBanner";

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

export default function SessionBannerWrapper() {
  const {
    sessionState,
    clockInTime,
    breakStartTime,
    actionPending,
    orgTimezone,
    actions,
  } = useSession();
  const { isActive: screenShareActive } = useScreenCaptureCtx();

  // Local timer — only this component re-renders every second, not the whole app
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const clockInTimeRef = useRef(clockInTime);
  const breakStartTimeRef = useRef(breakStartTime);
  const sessionStateRef = useRef(sessionState);

  useEffect(() => { clockInTimeRef.current = clockInTime; }, [clockInTime]);
  useEffect(() => { breakStartTimeRef.current = breakStartTime; }, [breakStartTime]);
  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);

  useEffect(() => {
    if (sessionState === "idle") {
      setSessionElapsed(0);
      setBreakElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      if (clockInTimeRef.current) {
        setSessionElapsed(secondsSince(clockInTimeRef.current));
      }
      if (sessionStateRef.current === "on-break" && breakStartTimeRef.current) {
        setBreakElapsed(secondsSince(breakStartTimeRef.current));
      } else {
        setBreakElapsed(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionState]);

  return (
    <SessionBanner
      state={sessionState}
      clockInTime={clockInTime}
      elapsedSeconds={sessionElapsed}
      breakElapsedSeconds={breakElapsed}
      screenShareActive={screenShareActive}
      timezone={orgTimezone}
      actionPending={actionPending}
      onClockIn={actions.clockIn}
      onClockOut={actions.clockOut}
      onStartBreak={actions.startBreak}
      onEndBreak={actions.endBreak}
    />
  );
}
