"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

type RangeKey = "today" | "week" | "month" | "year";

interface Insights {
  range: RangeKey;
  totalHoursMs: number;
  taskCount: number;
  daily: { date: string; ms: number }[];
  perVa: { vaId: string; vaName: string; ms: number }[];
  submissions: { submitted: number; approved: number; revisionRequested: number };
}

function BigStat({ value, label, color }: { value: string | number; label: string; color: "sage" | "terracotta" | "amber" | "slate-blue" }) {
  const colorClass = {
    sage: "text-sage",
    terracotta: "text-terracotta",
    amber: "text-amber",
    "slate-blue": "text-slate-blue",
  }[color];
  return (
    <div className="rounded-xl border border-sand bg-white px-5 py-4">
      <div className={`font-serif text-[28px] font-bold ${colorClass}`}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold text-bark">{label}</div>
    </div>
  );
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

export default function ClientInsightsPanel() {
  const [range, setRange] = useState<RangeKey>("week");
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await fetch(`/api/client-admin/insights?range=${range}`);
      if (!res.ok || cancelled) return;
      const json = await res.json();
      if (!cancelled) setData(json);
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              range === r.key ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="flex items-center gap-2 py-6 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <BigStat value={formatDuration(data.totalHoursMs)} label="Hours Logged" color="sage" />
            <BigStat value={data.taskCount} label="Tasks Worked" color="terracotta" />
            <BigStat value={data.submissions.approved} label="Approved" color="slate-blue" />
            <BigStat value={data.submissions.revisionRequested} label="Revision Requested" color="amber" />
          </div>

          {data.daily.length > 0 && (
            <div className="rounded-xl border border-sand bg-white p-4">
              <h3 className="text-xs font-bold text-espresso uppercase tracking-wide mb-3">Daily Hours</h3>
              <div className="space-y-1.5">
                {data.daily.map((d) => (
                  <div key={d.date} className="flex items-center justify-between text-[12px]">
                    <span className="text-bark">{d.date}</span>
                    <span className="font-semibold text-espresso">{formatDuration(d.ms)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.perVa.length > 0 && (
            <div className="rounded-xl border border-sand bg-white p-4">
              <h3 className="text-xs font-bold text-espresso uppercase tracking-wide mb-3">By VA</h3>
              <div className="space-y-1.5">
                {data.perVa.map((v) => (
                  <div key={v.vaId} className="flex items-center justify-between text-[12px]">
                    <span className="text-espresso font-semibold">{v.vaName}</span>
                    <span className="text-bark">{formatDuration(v.ms)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.totalHoursMs === 0 && (
            <div className="rounded-xl border border-sand bg-white p-4">
              <p className="text-sm font-medium text-espresso">No activity yet</p>
              <p className="mt-1 text-xs text-stone">Your VAs&apos; logged work will show up here once they start.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
