"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

interface Overview {
  activeCount: number;
  totalVAs: number;
  todayHoursMs: number;
  todayScreenshots: number;
  todayTasks: number;
}

function StatCard({
  value,
  label,
  sub,
  color,
}: {
  value: string | number;
  label: string;
  sub: string;
  color: "sage" | "terracotta" | "amber" | "slate-blue";
}) {
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
      {sub && <div className="mt-0.5 text-[10px] text-stone">{sub}</div>}
    </div>
  );
}

export default function ClientAdminOverview({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/client-admin/overview");
      if (!res.ok || cancelled) return;
      const json = await res.json();
      if (!cancelled) setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard value={data.activeCount} label="Active Now" sub={`of ${data.totalVAs} VA${data.totalVAs === 1 ? "" : "s"}`} color="sage" />
      <StatCard value={formatDuration(data.todayHoursMs)} label="Total Hours Today" sub="across your VAs" color="terracotta" />
      <StatCard value={data.todayScreenshots} label="Screenshots Today" sub="" color="slate-blue" />
      <StatCard value={data.todayTasks} label="Tasks Completed" sub="today" color="amber" />
    </div>
  );
}
