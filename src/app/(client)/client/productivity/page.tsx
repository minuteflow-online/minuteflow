"use client";

import { useState } from "react";
import ClientAssignTaskPanel from "@/components/ClientAssignTaskPanel";
import ClientSubmissionsPanel from "@/components/ClientSubmissionsPanel";

export default function ClientProductivityPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-ink">Productivity</h2>
        <p className="mt-1 text-sm text-bark">Assign work to your VAs and review what they turn in.</p>
      </div>

      <ClientAssignTaskPanel onAssigned={() => setRefreshKey((k) => k + 1)} />

      <ClientSubmissionsPanel refreshKey={refreshKey} />
    </div>
  );
}
