"use client";

import { useState } from "react";

/**
 * Asked when a recurring template is paused.
 *
 * Pausing without an end date means someone has to remember to come back and
 * press Resume, and nobody does — the schedule just quietly stops. So the date
 * is asked for up front, and an open-ended pause is the deliberate choice
 * rather than the default.
 */
export default function PauseTemplateDialog({
  templateName,
  onConfirm,
  onCancel,
}: {
  templateName: string;
  onConfirm: (pausedUntil: string | null) => void;
  onCancel: () => void;
}) {
  const [until, setUntil] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-sand bg-white p-5 shadow-xl">
        <h3 className="text-sm font-bold text-espresso">Pause a recurring template</h3>
        <p className="mt-1 text-[12px] text-stone">
          <span className="font-semibold text-espresso">{templateName}</span> stops producing tasks
          while it is paused, and the dates it already put on the calendar come back off. Anything
          already being worked on stays.
        </p>

        <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
          Pause until
        </label>
        <input
          type="date"
          value={until}
          min={today}
          onChange={(event) => setUntil(event.target.value)}
          className="mt-1 w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
        />
        <p className="mt-1 text-[11px] text-stone">
          It starts again by itself the day after. Leave this blank to pause with no end date.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => onConfirm(until || null)}
            className="w-full rounded-lg bg-sage px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-sage/90"
          >
            {until ? `Pause until ${until}` : "Pause with no end date"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg bg-stone/10 px-3 py-2 text-[12px] font-semibold text-stone transition-colors hover:bg-stone/20"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
