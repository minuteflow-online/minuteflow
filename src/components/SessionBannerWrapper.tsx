"use client";

import { useSession } from "@/contexts/SessionContext";
import { useScreenCaptureCtx } from "@/contexts/ScreenCaptureProvider";
import SessionBanner from "@/components/SessionBanner";

export default function SessionBannerWrapper() {
  const {
    sessionState,
    clockInTime,
    sessionElapsed,
    breakElapsed,
    actionPending,
    orgTimezone,
    actions,
  } = useSession();
  const { isActive: screenShareActive } = useScreenCaptureCtx();

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
