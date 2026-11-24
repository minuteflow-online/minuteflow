"use client";

import ClientInsightsPanel from "@/components/ClientInsightsPanel";

export default function ClientInsightsPage() {
  return (
    <>
      {/* Page Header — same as the staff Reports page */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">Reports</h1>
          <p className="mt-0.5 text-[13px] text-bark">Hours and submissions for your team</p>
        </div>
      </div>
      <ClientInsightsPanel />
    </>
  );
}
