"use client";

import { useState } from "react";
import ClientAssignTaskPanel from "@/components/ClientAssignTaskPanel";
import ClientOrgTasksPanel from "@/components/ClientOrgTasksPanel";

export default function ClientAssignmentPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-5">
      <ClientAssignTaskPanel onAssigned={() => setRefreshKey((k) => k + 1)} />
      <ClientOrgTasksPanel key={refreshKey} />
    </div>
  );
}
