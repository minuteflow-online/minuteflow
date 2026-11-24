"use client";

import ClientPortalPanel from "@/components/ClientPortalPanel";

export default function ClientPortalPage() {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">Portal</h1>
          <p className="mt-0.5 text-[13px] text-bark">Your organization and account settings</p>
        </div>
      </div>
      <ClientPortalPanel />
    </>
  );
}
