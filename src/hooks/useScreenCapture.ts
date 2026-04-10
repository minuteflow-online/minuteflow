"use client";

import { useRef, useState, useCallback, useEffect } from "react";

export interface UseScreenCaptureReturn {
  /** Whether the screen-sharing stream is currently active */
  isActive: boolean;
  /** Prompt the user to share their screen. Resolves true if granted, false otherwise. */
  requestStream: () => Promise<boolean>;
  /** Grab a single frame from the active stream. Returns a PNG Blob, or null if no stream. */
  captureFrame: () => Promise<Blob | null>;
  /** Stop the stream and clean up. */
  stopStream: () => void;
}

/**
 * Manages a persistent getDisplayMedia stream that stays open across task switches.
 * The VA allows screen sharing once, and we silently grab frames from it for the rest
 * of the browser session.
 */
export function useScreenCapture(): UseScreenCaptureReturn {
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const requestStream = useCallback(async (): Promise<boolean> => {
    // Already have a live stream
    if (streamRef.current && streamRef.current.getVideoTracks().some((t) => t.readyState === "live")) {
      setIsActive(true);
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Force the browser to pre-select "Entire Screen" in the share dialog
          displaySurface: "monitor",
          // Request reasonable resolution — not ultra-high to keep file sizes manageable
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setIsActive(true);

      // Listen for the user clicking "Stop sharing" in the browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          streamRef.current = null;
          setIsActive(false);
        });
      }

      return true;
    } catch {
      // User denied or closed the dialog
      return false;
    }
  }, []);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const stream = streamRef.current;
    if (!stream) return null;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") {
      // Stream died — clean up
      streamRef.current = null;
      setIsActive(false);
      return null;
    }

    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      // Wait a frame for the video to render
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);

      // Don't stop the stream — we want to keep it alive
      video.srcObject = null;
      video.remove();

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error("canvas.toBlob returned null"));
          },
          "image/png"
        );
      });

      canvas.remove();
      return blob;
    } catch (err) {
      console.error("captureFrame failed:", err);
      return null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsActive(false);
  }, []);

  return { isActive, requestStream, captureFrame, stopStream };
}
