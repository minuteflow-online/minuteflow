import { staticScreenReport } from "@/lib/staticScreenReport";

// A window onto the unchanged-screen check. Access is gated by
// (admin)/layout.tsx, same as every other admin page.

export const dynamic = "force-dynamic";

export default async function IdleCheckPage() {
  const rows = await staticScreenReport();
  const warning = rows.filter((r) => r.wouldWarn);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-espresso">Idle check</h1>
        <p className="text-[11px] text-stone/80">
          What the unchanged-screen check sees right now, for everyone on the clock. Reads only —
          opening this page warns nobody and closes nothing.
        </p>
      </div>

      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
            Clocked in right now
          </h3>
          <span className="text-[11px] text-stone/80">
            {rows.length} on the clock · {warning.length} would be warned
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-[11px] text-stone/80">Nobody is clocked in with a task running.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div
                key={r.name}
                className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border bg-white ${
                  r.wouldWarn ? "border-amber-200" : "border-sand"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-espresso leading-tight">
                    {r.name}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${
                      r.wouldWarn
                        ? "bg-amber-50 text-amber-600 border-amber-200"
                        : "bg-stone/10 text-stone border-stone/20"
                    }`}
                  >
                    {r.wouldWarn ? "would warn" : "no action"}
                  </span>
                </div>
                <div className="text-[11px] text-stone/80">
                  {r.captures} capture{r.captures === 1 ? "" : "s"} · {r.distinctHashes} distinct ·
                  spanning {r.spanMinutes} min{r.category ? ` · ${r.category}` : ""}
                  {r.onBreak ? " · on break" : ""}
                </div>
                <div className="text-[11px] text-walnut">{r.verdict}</div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-stone/80">
          A warning needs three or more captures carrying a hash, spanning at least 12 of the last
          15 minutes, every one identical. Anything short of that reads as &quot;cannot tell&quot;
          and stays silent — which is why an empty column here is a working check, not a broken one.
        </p>
      </div>
    </div>
  );
}
