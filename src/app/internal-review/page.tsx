"use client";

import { useEffect, useMemo, useState } from "react";

// /internal-review — Regie-only PIN-gated view of the same VA time/screenshot
// data as /admin/va-review. Exists because Regie has no MinuteFlow login of
// his own, so the real admin-role guard on /admin/va-review locks him out
// too. This route intentionally sits OUTSIDE the (admin) route group so it
// has no Supabase session requirement — instead every data call here goes
// through /api/internal/* routes gated by a shared PIN header, using the
// service-role key server-side (bypassing RLS) rather than a user session.
// This is NOT linked from any nav and is not shown to Toni Colina or any VA.

const PIN = "9876";
const SESSION_KEY = "mf_internal_review_auth";

type Va = { id: string; username: string; full_name: string; position: string | null };
type DayInfo = { date: string; hasTime: boolean; hasScreenshots: boolean };
type Verdict = "match" | "mismatch" | "uncertain";
type TimeEntry = {
  id: number;
  task_name: string;
  project: string | null;
  client_name: string | null;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
  client_memo: string | null;
};
type Shot = {
  id: number;
  filename: string;
  screenshot_type: string | null;
  drive_file_id: string | null;
  task_name?: string;
  capture_time: string | null;
};

const VERDICT_STYLES: Record<Verdict, { bg: string; fg: string; label: string }> = {
  match: { bg: "#e6f4ea", fg: "#1e7a34", label: "Match" },
  mismatch: { bg: "#fbe9e7", fg: "#b3261e", label: "Mismatch" },
  uncertain: { bg: "#fff4e0", fg: "#9a6700", label: "Uncertain" },
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLES[verdict];
  return (
    <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function PinGate({ children }: { children: React.ReactNode }) {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(SESSION_KEY) === "1") setAuthed(true);
    setChecking(false);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin === PIN) {
      localStorage.setItem(SESSION_KEY, "1");
      setAuthed(true);
      setError(false);
    } else {
      setError(true);
      setPin("");
    }
  }

  if (checking) return null;
  if (!authed) {
    return (
      <div style={{ maxWidth: 360, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <h1 style={{ fontSize: "1.2rem", marginBottom: 16 }}>Internal Review</h1>
        <form onSubmit={submit}>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc", textAlign: "center", fontSize: "1.1rem", letterSpacing: "0.2em" }}
            autoFocus
          />
          <div style={{ marginTop: 12 }}>
            <button type="submit">Enter</button>
          </div>
          {error && <p style={{ color: "#b3261e", marginTop: 8 }}>Wrong PIN.</p>}
        </form>
      </div>
    );
  }
  return <>{children}</>;
}

function apiFetch(path: string, opts: RequestInit = {}) {
  return fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), "x-internal-review-pin": PIN },
  }).then((r) => r.json());
}

function ReviewContent() {
  const [vas, setVas] = useState<Va[]>([]);
  const [va, setVa] = useState<Va | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [days, setDays] = useState<DayInfo[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [tab, setTab] = useState<"time" | "screenshots">("time");
  const [screenshotMode, setScreenshotMode] = useState<"raw" | "summary">("raw");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [rawShots, setRawShots] = useState<Shot[]>([]);
  const [summary, setSummary] = useState<{ logId: number; task_name: string; verdict: Verdict; summary: string; deviation: string }[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/internal/vas").then((d) => setVas(d.vas || []));
  }, []);

  useEffect(() => {
    if (!va) return;
    apiFetch(`/api/internal/vas/${va.id}/calendar?month=${month}`).then((d) => setDays(d.days || []));
  }, [va, month]);

  useEffect(() => {
    if (!va || !date) return;
    apiFetch(`/api/internal/vas/${va.id}/day/${date}/time`).then((d) => setTimeEntries(d.entries || []));
  }, [va, date]);

  useEffect(() => {
    if (!va || !date || tab !== "screenshots" || screenshotMode !== "raw") return;
    apiFetch(`/api/internal/vas/${va.id}/day/${date}/screenshots?mode=raw`).then((d) => setRawShots(d.screenshots || []));
  }, [va, date, tab, screenshotMode]);

  useEffect(() => {
    if (!va || !date || tab !== "screenshots" || screenshotMode !== "summary") return;
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(true);
    apiFetch(`/api/internal/vas/${va.id}/day/${date}/screenshots?mode=summary`)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setSummary(d.tasks);
      })
      .catch((e) => setSummaryError(e.message))
      .finally(() => setSummaryLoading(false));
  }, [va, date, tab, screenshotMode]);

  const dayMap = Object.fromEntries(days.map((d) => [d.date, d]));
  const [cy, cm] = month.split("-").map(Number);
  const numDays = new Date(cy, cm, 0).getDate();
  const cells = Array.from({ length: numDays }, (_, i) => {
    const dayNum = i + 1;
    const d = `${month}-${String(dayNum).padStart(2, "0")}`;
    return { dayNum, date: d, worked: !!dayMap[d] };
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: 24 }}>VA Time &amp; Screenshot Review (internal)</h1>

      {!va && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {vas.map((v) => (
            <button key={v.id} onClick={() => setVa(v)} style={{ textAlign: "left", padding: "12px 16px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer", background: "#fafafa" }}>
              <strong>{v.full_name}</strong> <span style={{ color: "#888" }}>@{v.username}{v.position ? ` · ${v.position}` : ""}</span>
            </button>
          ))}
        </div>
      )}

      {va && !date && (
        <>
          <button onClick={() => setVa(null)} style={{ marginBottom: 16 }}>&larr; All VAs</button>
          <h2 style={{ marginBottom: 12 }}>{va.full_name}</h2>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <button onClick={() => { const [y, m] = month.split("-").map(Number); setMonth(new Date(y, m - 2, 1).toISOString().slice(0, 7)); }}>&larr; Prev</button>
            <strong>{month}</strong>
            <button onClick={() => { const [y, m] = month.split("-").map(Number); setMonth(new Date(y, m, 1).toISOString().slice(0, 7)); }}>Next &rarr;</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {cells.map((c) => (
              <button key={c.date} onClick={() => c.worked && setDate(c.date)} disabled={!c.worked} style={{ padding: "10px 4px", borderRadius: 8, border: "1px solid #ddd", background: c.worked ? "#fafafa" : "transparent", cursor: c.worked ? "pointer" : "default", opacity: c.worked ? 1 : 0.35 }}>
                <div>{c.dayNum}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 4 }}>
                  {dayMap[c.date]?.hasTime && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#b3261e", display: "inline-block" }} title="Time recorded" />}
                  {dayMap[c.date]?.hasScreenshots && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1a56db", display: "inline-block" }} title="Screenshots" />}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {va && date && (
        <>
          <button onClick={() => setDate(null)} style={{ marginBottom: 16 }}>&larr; {va.full_name}&apos;s calendar</button>
          <h2 style={{ marginBottom: 12 }}>{va.full_name} &mdash; {date}</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setTab("time")} style={{ fontWeight: tab === "time" ? 700 : 400 }}>Time</button>
            <button onClick={() => setTab("screenshots")} style={{ fontWeight: tab === "screenshots" ? 700 : 400 }}>Screenshots</button>
          </div>

          {tab === "time" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {timeEntries.map((e) => (
                <div key={e.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "12px 16px" }}>
                  <div>
                    <strong>{e.task_name}</strong> <span style={{ color: "#888" }}>&middot; {e.project}{e.client_name ? ` · ${e.client_name}` : ""}</span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#555", marginTop: 4 }}>
                    {new Date(e.start_time).toLocaleTimeString()} &rarr; {e.end_time ? new Date(e.end_time).toLocaleTimeString() : "—"}
                    {e.duration_ms < 1000 && <span style={{ color: "#b3261e", marginLeft: 8 }}>&#9888; near-zero duration recorded &mdash; check Screenshots tab</span>}
                  </div>
                  {e.client_memo && <p style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>{e.client_memo}</p>}
                </div>
              ))}
              {!timeEntries.length && <p>No time entries for this day.</p>}
            </div>
          )}

          {tab === "screenshots" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button onClick={() => setScreenshotMode("raw")} style={{ fontWeight: screenshotMode === "raw" ? 700 : 400 }}>Raw</button>
                <button onClick={() => setScreenshotMode("summary")} style={{ fontWeight: screenshotMode === "summary" ? 700 : 400 }}>Summary</button>
              </div>

              {screenshotMode === "raw" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {rawShots.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #eee", fontSize: "0.85rem" }}>
                      <span style={{ color: "#888", minWidth: 90 }}>{s.capture_time ? new Date(s.capture_time).toLocaleTimeString() : "—"}</span>
                      <span style={{ textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700, color: "#888", minWidth: 70 }}>{s.screenshot_type}</span>
                      <span style={{ flex: 1 }}>{s.task_name}</span>
                      {s.drive_file_id && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/internal/drive-image?id=${s.drive_file_id}&pin=${PIN}`} alt="" style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 4, border: "1px solid #ddd" }} />
                      )}
                    </div>
                  ))}
                  {!rawShots.length && <p>No screenshots for this day.</p>}
                </div>
              )}

              {screenshotMode === "summary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {summaryLoading && <p>Summarizing screenshots&hellip; this calls a vision model per screenshot, may take 10-20s.</p>}
                  {summaryError && <p style={{ color: "#b3261e" }}>{summaryError}</p>}
                  {summary?.map((t) => (
                    <div key={t.logId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "12px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{t.task_name}</strong>
                        <VerdictBadge verdict={t.verdict} />
                      </div>
                      <p style={{ margin: "8px 0 0" }}>{t.summary}</p>
                      {t.deviation && t.deviation.toLowerCase() !== "none observed" && <p style={{ margin: "6px 0 0", color: "#b3261e" }}><strong>Deviation:</strong> {t.deviation}</p>}
                    </div>
                  ))}
                  {summary && !summary.length && <p>No tasks to summarize for this day.</p>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function InternalReviewPage() {
  return (
    <PinGate>
      <ReviewContent />
    </PinGate>
  );
}
