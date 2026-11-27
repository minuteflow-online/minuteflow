"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The client's Quick Pick — the same card and buttons the VA's own Quick Pick
 * (ProjectSidebar) shows, labelled exactly as the VA sees them. A client
 * doesn't log time from these; each button switches that action on or off on
 * their VAs' Quick Pick (organizations.quick_pick_message / _planning).
 */
export default function ClientQuickPickPanel({ orgId, orgName }: { orgId: string | null; orgName: string }) {
  const [message, setMessage] = useState(false);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    void supabase
      .from("organizations")
      .select("quick_pick_message, quick_pick_planning")
      .eq("id", orgId)
      .single()
      .then(({ data }) => {
        setMessage(Boolean(data?.quick_pick_message));
        setPlanning(Boolean(data?.quick_pick_planning));
      });
  }, [orgId]);

  const update = useCallback(
    async (field: "quick_pick_message" | "quick_pick_planning", value: boolean) => {
      if (!orgId) return;
      const supabase = createClient();
      await supabase.from("organizations").update({ [field]: value }).eq("id", orgId);
    },
    [orgId]
  );

  const name = orgName || "you";
  const actions = [
    {
      key: "quick_pick_planning" as const,
      on: planning,
      set: setPlanning,
      label: `🗂️ Planning/Sorting for ${name}`,
      onClass: "bg-amber text-white",
    },
    {
      key: "quick_pick_message" as const,
      on: message,
      set: setMessage,
      label: `💬 Message ${name}`,
      onClass: "bg-slate-blue text-white",
    },
  ];

  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      <div className="border-b border-parchment px-4 py-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Quick Pick</h3>
      </div>
      <div className="px-4 py-3">
        <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">Quick Actions</div>
        <div className="flex flex-col gap-2">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={!orgId}
              onClick={() => {
                a.set(!a.on);
                void update(a.key, !a.on);
              }}
              title={a.on ? "On your VAs' Quick Pick — click to turn off" : "Off — click to add it to your VAs' Quick Pick"}
              className={`w-full py-3 px-4 rounded-xl text-[12px] font-semibold cursor-pointer transition-all text-left leading-tight flex items-center justify-between gap-2 ${
                a.on ? a.onClass : "bg-stone/10 text-stone border border-dashed border-clay"
              }`}
            >
              <span>{a.label}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">{a.on ? "On" : "Off"}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-stone">
          These show on your VAs&apos; Quick Pick so they can log time for you in one click. Click one to turn it on or off.
        </p>
      </div>
    </div>
  );
}
