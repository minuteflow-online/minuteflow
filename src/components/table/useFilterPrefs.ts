"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Per-user, per-table persistence for a table's FILTER selections — the
// companion to useColumnPrefs (which handles column widths/visibility). Rather
// than owning the state, this LOADS the saved value once (localStorage instant,
// server durable) and hands back a debounced `persist`, so it drops cleanly into
// a table that already manages its own filter state: apply `stored` once
// `ready`, then call `persist(...)` whenever the filters change.
//
// The stored value must be JSON-serializable — serialize Sets to arrays first.

function storageKey(tableId: string, userId: string) {
  return `mf-filter-prefs:${tableId}:${userId}`;
}

export function useFilterPrefs<T extends object>(tableId: string, userId: string | null) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<T | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsTableId = `${tableId}:filters`;

  useEffect(() => {
    let cancelled = false;
    // Deferred to a microtask so state updates happen in a callback rather than
    // synchronously in the effect body (avoids cascading renders — see
    // react-hooks/set-state-in-effect).
    Promise.resolve().then(async () => {
      if (cancelled) return;
      if (!userId) {
        setReady(true);
        return;
      }
      let value: T | null = null;
      // 1) Instant local read.
      try {
        const raw = localStorage.getItem(storageKey(tableId, userId));
        if (raw) value = JSON.parse(raw) as T;
      } catch {
        // ignore corrupt/unavailable storage
      }
      // 2) Server is the durable source of truth.
      try {
        const res = await fetch(`/api/table-prefs?tableId=${encodeURIComponent(prefsTableId)}`, { cache: "no-store" });
        if (!cancelled && res.ok) {
          const { prefs } = (await res.json()) as { prefs: T | null };
          if (prefs) {
            value = prefs;
            localStorage.setItem(storageKey(tableId, userId), JSON.stringify(prefs));
          }
        }
      } catch {
        // offline — localStorage copy (step 1) still applies
      }
      if (!cancelled) {
        setStored(value);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, userId, prefsTableId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persist = useCallback(
    (value: T) => {
      if (!userId) return;
      try {
        localStorage.setItem(storageKey(tableId, userId), JSON.stringify(value));
      } catch {
        // storage full — server save below still runs
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        fetch("/api/table-prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: prefsTableId, prefs: value }),
        }).catch(() => {});
      }, 700);
    },
    [tableId, userId, prefsTableId]
  );

  return { ready, stored, persist };
}
