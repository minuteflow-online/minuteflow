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
}

interface ProjectSidebarProps {
  onQuickAction: (mapping: QuickActionMapping) => void;
  onAutoHoldAction: (mapping: QuickActionMapping) => void;
  isAdmin: boolean;
}

export default function ProjectSidebar({
  onQuickAction,
  onAutoHoldAction,
  isAdmin,
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
                onAutoHoldAction({
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
                onAutoHoldAction({
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


      </div>
    </div>
  );
}
