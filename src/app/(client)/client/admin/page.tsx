"use client";

import { useState } from "react";
import ClientAdminOverview from "@/components/ClientAdminOverview";
import ClientLiveTeamMonitor from "@/components/ClientLiveTeamMonitor";
import ClientScreenshotsPanel from "@/components/ClientScreenshotsPanel";

type Tab = "overview" | "screenshots";

export default function ClientAdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold text-ink">Admin</h2>
          <p className="mt-1 text-sm text-bark">Monitor and manage your own VAs.</p>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="px-3 py-1.5 rounded-lg border border-sand bg-white text-[11px] font-semibold text-walnut hover:border-terracotta hover:text-terracotta transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <ClientAdminOverview refreshKey={refreshKey} />

      <div className="flex border-b border-parchment">
        {(["overview", "screenshots"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
              tab === t
                ? "text-terracotta border-b-2 border-terracotta bg-terracotta-soft/40"
                : "text-stone hover:text-espresso border-b-2 border-transparent"
            }`}
          >
            {t === "overview" ? "Live Team Monitor" : "Screenshots"}
          </button>
        ))}
      </div>

      {tab === "overview" ? <ClientLiveTeamMonitor key={refreshKey} /> : <ClientScreenshotsPanel key={refreshKey} />}
    </div>
  );
}
