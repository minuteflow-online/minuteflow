/**
 * Transition time: the stretch between finishing one entry and starting the
 * next.
 *
 * The wizard opens when a task ends, and whatever time is left after the
 * wizard was actually being filled in is time nobody is tracked against. So
 * the gap is measured end-of-one to start-of-next, minus that entry's own
 * `form_fill_ms`, which is already reported separately as Wizard Time.
 *
 * Measured per person per session date, so an overnight boundary never counts
 * as a gap. A gap containing a Clock Out marker is skipped outright: that is
 * "went home and came back", not someone sitting on the wizard.
 *
 * This lives in its own file because Reports and the Team report both show it,
 * and a metric with two implementations is a metric with two answers.
 */

export type TransitionLog = {
  user_id: string;
  session_date?: string | null;
  start_time: string;
  end_time?: string | null;
  form_fill_ms?: number | null;
  category?: string | null;
};

export function computeTransitionMs(
  logs: TransitionLog[],
  /**
   * Clock Out rows, when the caller has already filtered them out of `logs`.
   * Reports does: its account/client filters would drop them, since a clock-out
   * carries no account. Omit it and they are read from `logs` itself.
   */
  clockOutMarkers?: TransitionLog[]
): number {
  const pairable = logs.filter(
    (l) => l.category !== "Clock Out" && l.start_time && l.end_time
  );

  const markers = clockOutMarkers ?? logs.filter((l) => l.category === "Clock Out");
  const clockOutsByUser = new Map<string, number[]>();
  for (const marker of markers) {
    if (marker.category !== "Clock Out" || !marker.start_time) continue;
    const list = clockOutsByUser.get(marker.user_id) ?? [];
    list.push(new Date(marker.start_time).getTime());
    clockOutsByUser.set(marker.user_id, list);
  }

  const byUserDay = new Map<string, TransitionLog[]>();
  for (const log of pairable) {
    const key = `${log.user_id}|${log.session_date ?? log.start_time.slice(0, 10)}`;
    const list = byUserDay.get(key) ?? [];
    list.push(log);
    byUserDay.set(key, list);
  }

  let total = 0;
  for (const dayLogs of byUserDay.values()) {
    const ordered = [...dayLogs].sort((a, b) => a.start_time.localeCompare(b.start_time));
    const clockOuts = clockOutsByUser.get(ordered[0].user_id) ?? [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const prev = ordered[i];
      const next = ordered[i + 1];
      const gapStart = new Date(prev.end_time!).getTime();
      const gapEnd = new Date(next.start_time).getTime();
      if (gapEnd <= gapStart) continue; // overlapping or back-to-back entries
      if (clockOuts.some((t) => t > gapStart && t < gapEnd)) continue;
      total += Math.max(0, gapEnd - gapStart - (prev.form_fill_ms || 0));
    }
  }
  return total;
}
