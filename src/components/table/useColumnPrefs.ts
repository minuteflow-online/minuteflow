"use client";

import { useCallback, useEffect, useState } from "react";

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

// Per-user, per-table column widths + visibility, persisted to localStorage.
// Each account gets their own layout — nothing here is shared or synced to
// the server, so it never needs a migration or touches other users' views.
export function useColumnPrefs(tableId: string, userId: string | null, columns: ColumnDef[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth]))
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    // Deferred to a microtask so the state updates happen in a callback
    // rather than synchronously in the effect body (avoids cascading
    // renders — see react-hooks/set-state-in-effect).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(storageKey(tableId, userId));
        if (!raw) return;
        const parsed = JSON.parse(raw) as StoredPrefs;
        setWidths((current) => ({ ...current, ...parsed.widths }));
        setHidden(new Set(parsed.hidden ?? []));
      } catch {
        // Corrupt or unavailable storage — fall back to defaults.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, userId]);

  const persist = useCallback(
    (nextWidths: Record<string, number>, nextHidden: Set<string>) => {
      if (!userId) return;
      try {
        localStorage.setItem(
          storageKey(tableId, userId),
          JSON.stringify({ widths: nextWidths, hidden: Array.from(nextHidden) })
        );
      } catch {
        // Storage full/unavailable — widths just won't persist this session.
      }
    },
    [tableId, userId]
  );

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
