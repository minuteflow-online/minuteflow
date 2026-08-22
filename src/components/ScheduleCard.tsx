"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CollapsibleCard from "@/components/CollapsibleCard";
import WorkDaysPicker from "@/components/WorkDaysPicker";
import { formatWorkDays, shiftHoursFromProfile, workDaysFromProfile } from "@/lib/budget";

// One Schedule card, rendered identically in the VA Portal and in Team
// Management. The days decide WHERE a daily budget lands, never how much of it
// there is — the limits themselves stay in the Budget and Limit card, which is
// admin-only. That split is why a VA can edit this one for themselves.

export type ScheduleCardProfile = {
  work_days?: number[] | null;
  shift_hours?: number | null;
  shift_start?: string | null;
  shift_end?: string | null;
};

export default function ScheduleCard({
  profile,
  userId,
  canEdit = true,
  onSaved,
  defaultOpen = false,
}: {
  profile: ScheduleCardProfile | null | undefined;
  userId: string;
  /** False renders the chips read-only — no Edit button, nothing focusable. */
  canEdit?: boolean;
  /** Called after a successful save so the caller can re-read the profile. */
  onSaved?: () => void;
  defaultOpen?: boolean;
}) {
  const supabase = createClient();
  const saved = workDaysFromProfile(profile);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<number[]>(saved);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setDays(workDaysFromProfile(profile));
  }, [profile]);

  const dailyHours = profile
    ? shiftHoursFromProfile({
        shift_hours: profile.shift_hours ?? null,
        shift_start: profile.shift_start ?? null,
        shift_end: profile.shift_end ?? null,
      })
    : null;

  const handleSave = async () => {
    // An empty list reads back as "every day" (see workDaysFromProfile), which
    // is the opposite of what clearing every chip looks like it means.
    if (days.length === 0) {
      setMsg({ type: "err", text: "Pick at least one work day." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const { data, error } = await supabase
      .from("profiles")
      .update({ work_days: [...days].sort((a, b) => a - b) })
      .eq("id", userId)
      .select("id");
    setSaving(false);
    if (error) {
      setMsg({ type: "err", text: `Couldn't save: ${error.message}` });
      return;
    }
    // `.select()` catches the silent case where RLS updates zero rows without
    // raising an error.
    if (!data || data.length === 0) {
      setMsg({ type: "err", text: "Save didn't apply — you may not have permission." });
      return;
    }
    setEditing(false);
    setMsg({ type: "ok", text: "Schedule saved." });
    onSaved?.();
  };

  return (
    <CollapsibleCard title="Schedule" summary={formatWorkDays(saved)} defaultOpen={defaultOpen}>
      {canEdit && !editing && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => { setEditing(true); setMsg(null); }}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Edit
          </button>
        </div>
      )}

      <WorkDaysPicker value={editing ? days : saved} onChange={editing ? setDays : undefined} />

      {editing && (
        <div className="flex gap-2 pt-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setDays(saved); setMsg(null); }}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {msg && (
        <p className={`mt-2 text-[11px] font-semibold ${msg.type === "ok" ? "text-sage" : "text-terracotta"}`}>{msg.text}</p>
      )}

      <div className="mt-3 space-y-1">
        {dailyHours != null && (
          <p className="text-[11px] text-bark">
            {profile?.shift_start && profile?.shift_end
              ? `${profile.shift_start}–${profile.shift_end} on a work day (${dailyHours.toFixed(2)}h).`
              : `${dailyHours.toFixed(2)}h of daily budget on a work day.`}
          </p>
        )}
        <p className="text-[11px] text-stone">
          Time logged on a day off still counts — it comes out of the weekly budget instead.
        </p>
      </div>
    </CollapsibleCard>
  );
}
