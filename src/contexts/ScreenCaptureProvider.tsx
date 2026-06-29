"use client";

import { createContext, useContext } from "react";
import { useScreenCapture, UseScreenCaptureReturn } from "@/hooks/useScreenCapture";

const ScreenCaptureContext = createContext<UseScreenCaptureReturn | null>(null);

export function ScreenCaptureProvider({ children }: { children: React.ReactNode }) {
  const value = useScreenCapture();
  return (
    <ScreenCaptureContext.Provider value={value}>
      {children}
    </ScreenCaptureContext.Provider>
  );
}

export function useScreenCaptureCtx(): UseScreenCaptureReturn {
  const ctx = useContext(ScreenCaptureContext);
  if (!ctx) throw new Error("useScreenCaptureCtx must be used within ScreenCaptureProvider");
  return ctx;
}
