"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The org's "Track messaging time as billable" switch, shown under the
 * client dashboard's Messages panel. Lifted out of the old client-only
 * messages panel when the client dashboard moved to the staff
 * DashboardMessagePanel, so the setting itself is unchanged. The org id comes
 * from the server page, so this doesn't add another auth lookup to a page
 * that already has several.
 */
export default function ClientMessagingTimeToggle({ orgId }: { orgId: string | null }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    void supabase
      .from("organizations")
      .select("track_messaging_time")
      .eq("id", orgId)
      .single()
      .then(({ data }) => setOn(Boolean(data?.track_messaging_time)));
  }, [orgId]);

  const toggle = useCallback(async () => {
    if (!orgId) return;
    const next = !on;
    setOn(next);
    const supabase = createClient();
    await supabase.from("organizations").update({ track_messaging_time: next }).eq("id", orgId);
  }, [orgId, on]);

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!orgId}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-sand bg-white px-3 py-2 text-[11px] font-semibold text-walnut disabled:opacity-50"
    >
      Track messaging time as billable
      <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${on ? "bg-sage" : "bg-stone/30"}`}>
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
