"use client";

import { useEffect, useState } from "react";

interface Shot {
  id: number;
  vaId: string;
  vaName: string;
  url: string | null;
  createdAt: string;
  failureReason: string | null;
}

export default function ClientScreenshotsPanel() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Shot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/client-admin/screenshots?limit=60");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setShots(data.screenshots ?? []);
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (shots.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No screenshots yet</p>
        <p className="mt-1 text-xs text-stone">Your VAs&apos; captures will show up here once they start.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shots.map((s) => (
          <button
            key={s.id}
            onClick={() => s.url && setViewing(s)}
            className="group rounded-lg border border-sand bg-white overflow-hidden text-left hover:border-terracotta transition-colors"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-parchment">
              {s.url ? (
                <img src={s.url} alt={`Screenshot from ${s.vaName}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-stone">
                  {s.failureReason || "No capture"}
                </div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="text-[11px] font-semibold text-espresso truncate">{s.vaName}</p>
              <p className="text-[10px] text-stone">{new Date(s.createdAt).toLocaleString()}</p>
            </div>
          </button>
        ))}
      </div>

      {viewing && viewing.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setViewing(null)}
        >
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-white text-sm">
              <span className="font-semibold">{viewing.vaName} · {new Date(viewing.createdAt).toLocaleString()}</span>
              <button onClick={() => setViewing(null)} className="text-xl leading-none">&times;</button>
            </div>
            <img src={viewing.url} alt={`Screenshot from ${viewing.vaName}`} className="w-full rounded-lg" />
          </div>
        </div>
      )}
    </>
  );
}
