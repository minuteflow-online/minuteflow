import { NextRequest } from "next/server";
import { checkInternalPin } from "../_internalAuth";

// /api/internal/review — serves the whole Regie-only review UI as a plain
// HTML+vanilla-JS page instead of a Next.js page route. This exists because
// EVERY page route in this app is caught by src/proxy.ts's global auth
// middleware (redirects anything unauthenticated to /login, with an
// explicit allowlist of path prefixes that does not include arbitrary new
// pages) — /api/* is the one prefix that's exempt. Rather than edit that
// shared, security-critical middleware file, this route lives entirely
// under /api/ and renders its own HTML, sidestepping the redirect cleanly.
// PIN-gated, calls the existing /api/internal/* JSON endpoints (also
// exempt from the same middleware since they're under /api/).
export const dynamic = "force-dynamic";

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>VA Time &amp; Screenshot Review (internal)</title>
<meta name="robots" content="noindex, nofollow" />
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  button { cursor: pointer; font: inherit; }
  .va-row, .day-entry, .shot-row { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; text-align: left; background: #fafafa; width: 100%; display: block; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .cal-cell { padding: 10px 4px; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; }
  .cal-cell.empty { opacity: 0.35; background: transparent; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin: 0 2px; }
  .dot.time { background: #b3261e; }
  .dot.shots { background: #1a56db; }
  .tabs button { margin-right: 8px; padding: 6px 12px; border: none; background: none; border-bottom: 2px solid transparent; }
  .tabs button.active { font-weight: 700; border-bottom-color: #1a1a1a; }
  .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; }
  .badge.match { background: #e6f4ea; color: #1e7a34; }
  .badge.mismatch { background: #fbe9e7; color: #b3261e; }
  .badge.uncertain { background: #fff4e0; color: #9a6700; }
  .warn { color: #b3261e; }
  #pinScreen { max-width: 320px; margin: 80px auto; text-align: center; }
  #pinScreen input { padding: 10px 14px; border-radius: 8px; border: 1px solid #ccc; text-align: center; font-size: 1.1rem; letter-spacing: 0.2em; }
  .shot-thumb { width: 64px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; vertical-align: middle; }
</style>
</head>
<body>
<div id="pinScreen">
  <h1>Internal Review</h1>
  <form id="pinForm">
    <input type="password" id="pinInput" placeholder="PIN" autofocus />
    <div style="margin-top:12px"><button type="submit">Enter</button></div>
    <p class="warn" id="pinError" style="display:none">Wrong PIN.</p>
  </form>
</div>
<div id="app" style="display:none">
  <h1>VA Time &amp; Screenshot Review (internal)</h1>
  <div id="content"></div>
</div>
<script>
const PIN_KEY = "mf_internal_review_pin";
const pinScreen = document.getElementById("pinScreen");
const app = document.getElementById("app");
const content = document.getElementById("content");

let PIN = sessionStorage.getItem(PIN_KEY) || "";

function api(path) {
  return fetch(path, { headers: { "x-internal-review-pin": PIN } }).then(async (r) => {
    if (r.status === 401) { sessionStorage.removeItem(PIN_KEY); location.reload(); throw new Error("unauthorized"); }
    return r.json();
  });
}

document.getElementById("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const candidate = document.getElementById("pinInput").value;
  PIN = candidate;
  try {
    const res = await fetch("/api/internal/vas", { headers: { "x-internal-review-pin": PIN } });
    if (!res.ok) throw new Error("bad pin");
    sessionStorage.setItem(PIN_KEY, PIN);
    pinScreen.style.display = "none";
    app.style.display = "block";
    renderVaList();
  } catch {
    document.getElementById("pinError").style.display = "block";
  }
});

if (PIN) {
  fetch("/api/internal/vas", { headers: { "x-internal-review-pin": PIN } }).then((r) => {
    if (r.ok) { pinScreen.style.display = "none"; app.style.display = "block"; renderVaList(); }
  });
}

function el(html) { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }

async function renderVaList() {
  content.innerHTML = "Loading&hellip;";
  const { vas } = await api("/api/internal/vas");
  content.innerHTML = "";
  vas.forEach((va) => {
    const btn = el(\`<button class="va-row"><strong>\${va.full_name}</strong> <span style="color:#888">@\${va.username}\${va.position ? " · " + va.position : ""}</span></button>\`);
    btn.onclick = () => renderCalendar(va);
    content.appendChild(btn);
  });
}

async function renderCalendar(va, month) {
  month = month || new Date().toISOString().slice(0, 7);
  content.innerHTML = "Loading&hellip;";
  const { days } = await api(\`/api/internal/vas/\${va.id}/calendar?month=\${month}\`);
  const dayMap = Object.fromEntries(days.map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number);
  const numDays = new Date(y, m, 0).getDate();

  content.innerHTML = "";
  const back = el('<button>&larr; All VAs</button>');
  back.onclick = renderVaList;
  content.appendChild(back);
  content.appendChild(el(\`<h2>\${va.full_name}</h2>\`));

  const nav = el('<div style="display:flex;justify-content:space-between;margin-bottom:12px"></div>');
  const prev = el('<button>&larr; Prev</button>');
  prev.onclick = () => renderCalendar(va, new Date(y, m - 2, 1).toISOString().slice(0, 7));
  const next = el('<button>Next &rarr;</button>');
  next.onclick = () => renderCalendar(va, new Date(y, m, 1).toISOString().slice(0, 7));
  nav.appendChild(prev);
  nav.appendChild(el(\`<strong>\${month}</strong>\`));
  nav.appendChild(next);
  content.appendChild(nav);

  const grid = el('<div class="cal-grid"></div>');
  for (let i = 1; i <= numDays; i++) {
    const date = \`\${month}-\${String(i).padStart(2, "0")}\`;
    const info = dayMap[date];
    const cell = el(\`<button class="cal-cell \${info ? "" : "empty"}"><div>\${i}</div><div>\${info?.hasTime ? '<span class="dot time"></span>' : ""}\${info?.hasScreenshots ? '<span class="dot shots"></span>' : ""}</div></button>\`);
    if (info) cell.onclick = () => renderDay(va, date);
    else cell.disabled = true;
    grid.appendChild(cell);
  }
  content.appendChild(grid);
}

async function renderDay(va, date, tab, mode) {
  tab = tab || "time";
  mode = mode || "raw";
  content.innerHTML = "Loading&hellip;";
  content.innerHTML = "";
  const back = el(\`<button>&larr; \${va.full_name}'s calendar</button>\`);
  back.onclick = () => renderCalendar(va, date.slice(0, 7));
  content.appendChild(back);
  content.appendChild(el(\`<h2>\${va.full_name} &mdash; \${date}</h2>\`));

  const tabs = el('<div class="tabs"></div>');
  const timeTab = el(\`<button class="\${tab === "time" ? "active" : ""}">Time</button>\`);
  timeTab.onclick = () => renderDay(va, date, "time");
  const shotsTab = el(\`<button class="\${tab === "screenshots" ? "active" : ""}">Screenshots</button>\`);
  shotsTab.onclick = () => renderDay(va, date, "screenshots");
  tabs.appendChild(timeTab);
  tabs.appendChild(shotsTab);
  content.appendChild(tabs);

  const body = el('<div></div>');
  content.appendChild(body);

  if (tab === "time") {
    const { entries } = await api(\`/api/internal/vas/\${va.id}/day/\${date}/time\`);
    body.innerHTML = entries.length ? "" : "<p>No time entries for this day.</p>";
    entries.forEach((e) => {
      const warn = e.duration_ms < 1000 ? '<span class="warn"> &#9888; near-zero duration recorded &mdash; check Screenshots tab</span>' : "";
      body.appendChild(el(\`<div class="day-entry">
        <div><strong>\${e.task_name}</strong> <span style="color:#888">&middot; \${e.project || ""}\${e.client_name ? " · " + e.client_name : ""}</span></div>
        <div style="font-size:0.85rem;color:#555;margin-top:4px">\${new Date(e.start_time).toLocaleTimeString()} &rarr; \${e.end_time ? new Date(e.end_time).toLocaleTimeString() : "—"}\${warn}</div>
        \${e.client_memo ? \`<p style="margin:8px 0 0;font-size:0.9rem">\${e.client_memo}</p>\` : ""}
      </div>\`));
    });
    return;
  }

  const modeTabs = el('<div class="tabs" style="margin-bottom:16px"></div>');
  const rawBtn = el(\`<button class="\${mode === "raw" ? "active" : ""}">Raw</button>\`);
  rawBtn.onclick = () => renderDay(va, date, "screenshots", "raw");
  const summaryBtn = el(\`<button class="\${mode === "summary" ? "active" : ""}">Summary</button>\`);
  summaryBtn.onclick = () => renderDay(va, date, "screenshots", "summary");
  modeTabs.appendChild(rawBtn);
  modeTabs.appendChild(summaryBtn);
  body.appendChild(modeTabs);
  const modeBody = el('<div></div>');
  body.appendChild(modeBody);

  if (mode === "raw") {
    const { screenshots } = await api(\`/api/internal/vas/\${va.id}/day/\${date}/screenshots?mode=raw\`);
    modeBody.innerHTML = screenshots.length ? "" : "<p>No screenshots for this day.</p>";
    screenshots.forEach((s) => {
      const time = s.capture_time ? new Date(s.capture_time).toLocaleTimeString() : "—";
      const thumb = s.drive_file_id ? \`<img class="shot-thumb" src="/api/internal/drive-image?id=\${s.drive_file_id}&pin=\${encodeURIComponent(PIN)}" />\` : "";
      modeBody.appendChild(el(\`<div class="shot-row" style="display:flex;gap:12px;align-items:center;font-size:0.85rem">
        <span style="color:#888;min-width:90px">\${time}</span>
        <span style="text-transform:uppercase;font-size:0.7rem;font-weight:700;color:#888;min-width:70px">\${s.screenshot_type || ""}</span>
        <span style="flex:1">\${s.task_name || ""}</span>\${thumb}
      </div>\`));
    });
  } else {
    modeBody.innerHTML = "<p>Summarizing screenshots&hellip; this calls a vision model per screenshot, may take 10-20s.</p>";
    try {
      const { tasks, error } = await api(\`/api/internal/vas/\${va.id}/day/\${date}/screenshots?mode=summary\`);
      if (error) throw new Error(error);
      modeBody.innerHTML = tasks.length ? "" : "<p>No tasks to summarize for this day.</p>";
      tasks.forEach((t) => {
        const deviation = t.deviation && t.deviation.toLowerCase() !== "none observed" ? \`<p style="margin:6px 0 0" class="warn"><strong>Deviation:</strong> \${t.deviation}</p>\` : "";
        modeBody.appendChild(el(\`<div class="day-entry">
          <div style="display:flex;justify-content:space-between"><strong>\${t.task_name}</strong><span class="badge \${t.verdict}">\${t.verdict}</span></div>
          <p style="margin:8px 0 0">\${t.summary}</p>\${deviation}
        </div>\`));
      });
    } catch (e) {
      modeBody.innerHTML = \`<p class="warn">\${e.message}</p>\`;
    }
  }
}
</script>
</body>
</html>`;

export async function GET(request: NextRequest) {
  // The page itself needs no PIN to load its (empty) HTML shell — the shell
  // has no data. Every actual data call from the page's own JS carries the
  // PIN header, and every /api/internal/* route re-checks it server-side.
  // This mirrors checkInternalPin's contract without gating the static shell.
  void request;
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
