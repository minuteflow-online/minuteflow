"use client";

import ClientInsightsPanel from "@/components/ClientInsightsPanel";

export default function ClientInsightsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-ink">Insights</h2>
        <p className="mt-1 text-sm text-bark">Hours and submission stats for your own team.</p>
      </div>

      <ClientInsightsPanel />
    </div>
  );
}
