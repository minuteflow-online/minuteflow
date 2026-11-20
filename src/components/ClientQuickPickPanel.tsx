"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
        on ? "bg-sage" : "bg-stone/30"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function ClientQuickPickPanel() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [message, setMessage] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: userResult } = await supabase.auth.getUser();
        const userId = userResult.user?.id;
        if (!userId) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", userId)
          .single();
        if (!profile?.organization_id) return;
        setOrgId(profile.organization_id);
        const { data: org } = await supabase
          .from("organizations")
          .select("quick_pick_message, quick_pick_planning")
          .eq("id", profile.organization_id)
          .single();
        setMessage(Boolean(org?.quick_pick_message));
        setPlanning(Boolean(org?.quick_pick_planning));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const update = useCallback(async (field: "quick_pick_message" | "quick_pick_planning", value: boolean) => {
    if (!orgId) return;
    const supabase = createClient();
    await supabase.from("organizations").update({ [field]: value }).eq("id", orgId);
  }, [orgId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Quick Pick</h3>
      <p className="text-xs text-stone">
        Add quick actions to your VA&apos;s Quick Pick menu, so they can log time working for you with one click.
      </p>
      <div className="space-y-2">
        <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-sand">
          <div>
            <p className="text-[13px] font-semibold text-espresso">💬 Message Me</p>
            <p className="text-[11px] text-stone">Lets your VA log time messaging you with one click.</p>
          </div>
          <Toggle on={message} onClick={() => { setMessage((v) => !v); void update("quick_pick_message", !message); }} />
        </div>
        <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-sand">
          <div>
            <p className="text-[13px] font-semibold text-espresso">🗂️ Planning/Sorting</p>
            <p className="text-[11px] text-stone">Lets your VA log time planning or sorting work for you.</p>
          </div>
          <Toggle on={planning} onClick={() => { setPlanning((v) => !v); void update("quick_pick_planning", !planning); }} />
        </div>
      </div>
    </div>
  );
}
