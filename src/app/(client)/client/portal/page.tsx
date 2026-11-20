"use client";

import ClientPortalPanel from "@/components/ClientPortalPanel";

export default function ClientPortalPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-ink">Portal</h2>
        <p className="mt-1 text-sm text-bark">Your organization and account settings.</p>
      </div>

      <ClientPortalPanel />
    </div>
  );
}
