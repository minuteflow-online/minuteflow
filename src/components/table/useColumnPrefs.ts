"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ColumnDef = {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
};

type StoredPrefs = {
  widths: Record<string, number>;
  hidden: string[];
};

function storageKey(tableId: string, userId: string) {
  return `mf-table-prefs:${tableId}:${userId}`;
}

// Per-user, per-table column widths + visibility. Written to localStorage
// immediately (instant, no flicker on this device) and synced to
// /api/table-prefs on a debounce (so a column-resize drag doesn't fire a
// request per pixel) — the server copy is what lets the view survive a
// fresh login on a different browser/device.
export function useColumnPrefs(tableId: string, userId: string | null, columns: ColumnDef[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth]))
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;
    // Deferred to a microtask so the state updates happen in a callback
    // rather than synchronously in the effect body (avoids cascading
    // renders — see react-hooks/set-state-in-effect).
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;

      // 1) Instant local read so there's no flicker on this device.
      try {
        const raw = localStorage.getItem(storageKey(tableId, userId));
        if (raw) {
          const parsed = JSON.parse(raw) as StoredPrefs;
          setWidths((current) => ({ ...current, ...parsed.widths }));
          setHidden(new Set(parsed.hidden ?? []));
        }
      } catch {
        // Corrupt or unavailable storage — fall back to defaults.
      }

      // 2) Server is the durable source of truth (survives a fresh login on
      // another device) — apply it on top once it arrives.
      try {
        const res = await fetch(`/api/table-prefs?tableId=${encodeURIComponent(tableId)}`, { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const { prefs } = (await res.json()) as { prefs: StoredPrefs | null };
        if (!prefs) return;
        setWidths((current) => ({ ...current, ...prefs.widths }));
        setHidden(new Set(prefs.hidden ?? []));
        localStorage.setItem(storageKey(tableId, userId), JSON.stringify(prefs));
      } catch {
        // Offline/unavailable — the localStorage copy from step 1 still applies.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, userId]);

  const persist = useCallback(
    (nextWidths: Record<string, number>, nextHidden: Set<string>) => {
      if (!userId) return;
      const payload: StoredPrefs = { widths: nextWidths, hidden: Array.from(nextHidden) };

      try {
        localStorage.setItem(storageKey(tableId, userId), JSON.stringify(payload));
      } catch {
        // Storage full/unavailable — falls through to the server save below.
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        fetch("/api/table-prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId, prefs: payload }),
        }).catch(() => {
          // Best-effort — the localStorage copy already has the latest state.
        });
      }, 700);
    },
    [tableId, userId]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const setColumnWidth = useCallback(
    (key: string, width: number) => {
      setWidths((current) => {
        const next = { ...current, [key]: width };
        persist(next, hidden);
        return next;
      });
    },
    [hidden, persist]
  );

  const toggleColumnVisible = useCallback(
    (key: string) => {
      setHidden((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persist(widths, next);
        return next;
      });
    },
    [widths, persist]
  );

  return { widths, hidden, setColumnWidth, toggleColumnVisible };
}
