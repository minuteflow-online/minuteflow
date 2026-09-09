// Dev helper: waits for the Vite dev server to come up, then launches
// Electron pointed at it. Kept as plain Node (no deps beyond wait-on) so it
// runs before any TypeScript build step exists.
//
// Launches the electron binary directly (via require("electron"), which
// resolves to electron.exe's path rather than the Electron API) instead of
// `npx electron`. Spawning npx.cmd on Windows throws EINVAL on Node versions
// with the CVE-2024-27980 hardening (spawn() no longer runs .cmd/.bat files
// without shell:true) — going straight to the binary sidesteps that and the
// shell-quoting it would otherwise need.
const { spawn } = require("child_process");
const waitOn = require("wait-on");
const electronPath = require("electron");

const URL = "http://localhost:5173";

waitOn({ resources: [URL], timeout: 30000 })
  .then(() => {
    const electron = spawn(electronPath, ["."], {
      stdio: "inherit",
      env: { ...process.env, VITE_DEV_SERVER_URL: URL },
    });
    electron.on("exit", (code) => process.exit(code ?? 0));
    electron.on("error", (err) => {
      console.error("[MinuteFlow] Failed to launch Electron:", err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error("[MinuteFlow] Vite dev server never came up:", err);
    process.exit(1);
  });
