"use client";

import { useEffect, useState } from "react";
import AssignedTasksWidget from "@/components/AssignedTasksWidget";
import BudgetWidget from "@/components/BudgetWidget";
import { createClient } from "@/lib/supabase/client";

interface VaOption {
  id: string;
  full_name: string;
}

type Tab = "assigned" | "budget";

const noop = () => {};

export default function ClientAssignedTasksPanel() {
  const [vas, setVas] = useState<VaOption[]>([]);
  const [selectedVaId, setSelectedVaId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [activeTab, setActiveTab] = useState<Tab>("assigned");

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [rosterRes, tzResult, userResult] = await Promise.all([
          fetch("/api/organization-invites"),
          fetch("/api/client-admin/team-context", { cache: "no-store" }),
          supabase.auth.getUser(),
        ]);
        setViewerId(userResult.data.user?.id ?? null);
        const rosterData = await rosterRes.json();
        interface MemberRow {
          status: "invited" | "active";
          va_id: string;
          profiles: { full_name: string } | null;
        }
        const active: VaOption[] = ((rosterData.members ?? []) as MemberRow[])
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.va_id, full_name: m.profiles?.full_name ?? "Unknown" }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        setVas(active);
        setSelectedVaId((current) => current ?? active[0]?.id ?? null);
        // From the server — a client can't read the company settings directly.
        const context = tzResult.ok ? ((await tzResult.json()) as { timezone?: string }) : {};
        if (context.timezone) setOrgTimezone(context.timezone);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (vas.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="mt-1 text-xs text-stone">
          Invite a VA from Your Team above to start monitoring their tasks here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex border-b border-parchment">
        {(["assigned", "budget"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
              activeTab === tab
                ? "text-terracotta border-b-2 border-terracotta bg-terracotta-soft/40"
                : "text-stone hover:text-espresso border-b-2 border-transparent"
            }`}
          >
            {tab === "assigned" ? "Assigned Tasks" : "Budget and Limit"}
          </button>
        ))}
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-stone whitespace-nowrap">Viewing:</span>
          <select
            value={selectedVaId ?? ""}
            onChange={(e) => setSelectedVaId(e.target.value || null)}
            className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          >
            {vas.map((va) => (
              <option key={va.id} value={va.id}>{va.full_name}</option>
            ))}
          </select>
        </div>

        {selectedVaId && viewerId && activeTab === "assigned" && (
          <AssignedTasksWidget
            key={`assigned-${selectedVaId}`}
            userId={viewerId}
            sessionState="idle"
            hasActiveTask={false}
            onPlayAssignedTask={noop}
            onPlayTodo={noop}
            orgTimezone={orgTimezone}
            viewAsVaId={selectedVaId}
            bare
          />
        )}

        {selectedVaId && activeTab === "budget" && (
          <BudgetWidget
            key={`budget-${selectedVaId}`}
            currentUserId={selectedVaId}
            refreshKey={0}
            readOnly
            bare
          />
        )}
      </div>
    </div>
  );
}
