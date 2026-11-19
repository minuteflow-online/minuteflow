"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ProjectTag {
  id: number;
  account: string;
  project_name: string;
  sort_order: number;
  is_active: boolean;
}

export interface QuickActionMapping {
  category: string;
  task_name: string;
  account: string;
  project: string;
  client_name?: string;
  organization_id?: string | null;
}

/** One client org's Quick Pick settings — which of their own two optional
 *  actions they've turned on for the VAs working under them. */
export interface ClientQuickPick {
  organizationId: string;
  orgName: string;
  message: boolean;
  planning: boolean;
}

interface ProjectSidebarProps {
  onQuickAction: (mapping: QuickActionMapping) => void;
  // Stops whatever's running (no on-hold, no wizard) and starts this instead —
  // same as the Start button everywhere else (Toni's call, 2026-11-05).
  onQuickSwitchAction: (mapping: QuickActionMapping) => void;
  isAdmin: boolean;
  /** Client orgs this VA belongs to that have turned on at least one Quick
   *  Pick action — each gets its own small section below the fixed ones. */
  clientQuickPicks?: ClientQuickPick[];
}

export default function ProjectSidebar({
  onQuickAction,
  onQuickSwitchAction,
  isAdmin,
  clientQuickPicks = [],
}: ProjectSidebarProps) {
  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-parchment px-4 py-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Quick Pick
        </h3>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {/* Quick Message Actions */}
        <div className="px-4 py-3 border-b border-parchment">
          <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
            Quick Actions
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() =>
                onQuickSwitchAction({
                  category: "Planning",
                  task_name: "Planning/Sorting",
                  account: "Virtual Concierge",
                  project: "Set-up",
                  client_name: "Toni Colina",
                })
              }
              className="w-full py-3 px-4 rounded-xl bg-amber text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-amber/90 text-left leading-tight"
            >
              🗂️ Planning/Sorting
            </button>
            <button
              onClick={() =>
                onQuickSwitchAction({
                  category: "Communication",
                  task_name: "Message for Guidance/Instructions",
                  account: "Virtual Concierge",
                  project: "Supervision",
                  client_name: "Toni Colina",
                })
              }
              className="w-full py-3 px-4 rounded-xl bg-slate-blue text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#4a5568] text-left leading-tight"
            >
              💬 Message for Guidance/Instructions
            </button>
            <button
              onClick={() =>
                onQuickSwitchAction({
                  category: "Communication",
                  task_name: "General Message",
                  account: "Virtual Concierge",
                  project: "Supervision",
                  client_name: "Toni Colina",
                })
              }
              className="w-full py-3 px-4 rounded-xl bg-terracotta-soft text-terracotta text-[12px] font-semibold cursor-pointer transition-all hover:bg-terracotta hover:text-white text-left leading-tight border border-terracotta/30"
            >
              📨 General Message
            </button>
          </div>
        </div>

        {/* One section per client org that's turned on at least one action —
            each a Communication-category switch the same as the fixed ones
            above, just tagged with that org's id so it counts toward their
            own Activity Log/Budget instead of the agency's. */}
        {clientQuickPicks
          .filter((c) => c.message || c.planning)
          .map((c) => (
            <div key={c.organizationId} className="px-4 py-3 border-b border-parchment">
              <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
                {c.orgName}
              </div>
              <div className="flex flex-col gap-2">
                {c.message && (
                  <button
                    onClick={() =>
                      onQuickSwitchAction({
                        category: "Communication",
                        task_name: `Message ${c.orgName}`,
                        account: c.orgName,
                        project: "Client Work",
                        client_name: c.orgName,
                        organization_id: c.organizationId,
                      })
                    }
                    className="w-full py-3 px-4 rounded-xl bg-slate-blue text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#4a5568] text-left leading-tight"
                  >
                    💬 Message {c.orgName}
                  </button>
                )}
                {c.planning && (
                  <button
                    onClick={() =>
                      onQuickSwitchAction({
                        category: "Planning",
                        task_name: `Planning/Sorting for ${c.orgName}`,
                        account: c.orgName,
                        project: "Client Work",
                        client_name: c.orgName,
                        organization_id: c.organizationId,
                      })
                    }
                    className="w-full py-3 px-4 rounded-xl bg-amber text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-amber/90 text-left leading-tight"
                  >
                    🗂️ Planning/Sorting for {c.orgName}
                  </button>
                )}
              </div>
            </div>
          ))}

      </div>
    </div>
  );
}
