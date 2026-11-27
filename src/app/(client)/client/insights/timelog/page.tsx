"use client";

import ClientActivityLogPanel from "@/components/ClientActivityLogPanel";

export default function ClientTimeLogPage() {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">Time Log</h1>
          <p className="mt-0.5 text-[13px] text-bark">Time your VAs logged on your tasks</p>
        </div>
      </div>
      <ClientActivityLogPanel />
    </>
  );
}
