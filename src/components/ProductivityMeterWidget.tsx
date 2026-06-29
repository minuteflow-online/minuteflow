"use client";

import { formatDuration } from "@/lib/utils";

type ImprovementDirection = "higher_better" | "lower_better" | "neutral";

type ProductivityMeterProps = {
  label: string;
  currentMs: number;
  denominatorMs: number;
  prevMs?: number;
  prevDenominatorMs?: number;
  redWhenExceeded?: boolean;
  noAllowanceWhenZero?: boolean;
  improvementDirection?: ImprovementDirection;
};

function getComparisonBarColor(currentPct: number, prevPct: number, dir: ImprovementDirection): string {
  if (dir === "neutral") return "bg-sage";
  const delta = currentPct - prevPct;
  if (Math.abs(delta) <= 1) return "bg-amber";
  if (dir === "higher_better") return delta > 0 ? "bg-sage" : "bg-terracotta";
  return delta < 0 ? "bg-sage" : "bg-terracotta";
}

export function ProductivityMeterWidget({
  label,
  currentMs,
  denominatorMs,
  prevMs = 0,
  prevDenominatorMs = 0,
  redWhenExceeded = false,
  noAllowanceWhenZero = false,
  improvementDirection,
}: ProductivityMeterProps) {
  const noAllowance = noAllowanceWhenZero && denominatorMs === 0;
  const pct = denominatorMs > 0 ? Math.min((currentMs / denominatorMs) * 100, 999) : 0;
  const barPct = Math.min(pct, 100);
  const exceeded = redWhenExceeded && denominatorMs > 0 && currentMs > denominatorMs;

  const prevPct = prevDenominatorMs > 0 ? Math.min((prevMs / prevDenominatorMs) * 100, 100) : 0;
  const hasPrev = prevMs > 0 || prevDenominatorMs > 0;

  let barColor: string;
  if (hasPrev && improvementDirection) {
    barColor = getComparisonBarColor(pct, prevPct, improvementDirection);
  } else {
    barColor = exceeded ? "bg-terracotta" : "bg-sage";
  }

  const rightLabel = redWhenExceeded && denominatorMs > 0
    ? `${formatDuration(currentMs)} / ${formatDuration(denominatorMs)}`
    : formatDuration(currentMs);

  const prevRightLabel = redWhenExceeded && prevDenominatorMs > 0
    ? `${formatDuration(prevMs)} / ${formatDuration(prevDenominatorMs)}`
    : formatDuration(prevMs);

  return (
    <div className="flex items-center gap-3">
      <div className="w-[110px] shrink-0 text-[12px] font-semibold text-espresso truncate">
        {label}
      </div>
      <div className="flex-1 space-y-1">
        {noAllowance ? (
          <div className="flex items-center gap-2">
            <div className="w-[30px] shrink-0" />
            <div className="flex-1">
              <span className="text-[10px] text-bark italic">No allowance</span>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-[30px] shrink-0 text-right text-[10px] font-semibold text-espresso">
                {pct.toFixed(0)}%
              </div>
              <div className="flex-1 h-2.5 rounded bg-sand/60 overflow-hidden">
                <div
                  className={`h-full rounded ${barColor}`}
                  style={{ width: `${Math.max(barPct, currentMs > 0 ? 2 : 0)}%` }}
                />
              </div>
              <div className="w-[130px] shrink-0 text-right text-[10px] text-espresso">
                {rightLabel}
              </div>
            </div>
            {hasPrev && (
              <div className="flex items-center gap-2 opacity-70">
                <div className="w-[30px] shrink-0 text-right text-[10px] text-bark">
                  {prevPct.toFixed(0)}%
                </div>
                <div className="flex-1 h-2 rounded bg-sand/40 overflow-hidden">
                  <div
                    className="h-full rounded bg-bark"
                    style={{ width: `${Math.max(prevPct, prevMs > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <div className="w-[130px] shrink-0 text-right text-[10px] text-bark">
                  {prevRightLabel}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
