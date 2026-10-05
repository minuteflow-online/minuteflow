import type { NextConfig } from "next";

// The desktop app (Electron — a different origin from minuteflow.click, no
// browser cookies to carry) authenticates these specific routes with a
// bearer token instead (see src/lib/supabase/server.ts's createClient() doc
// and PRs #167/#168/#210). A browser blocks reading a cross-origin response
// without these headers on BOTH the preflight OPTIONS and the real response
// — this app never defined its own CORS handling, so every one of these
// calls was silently failing before this. Wildcard origin is safe here:
// there's no Access-Control-Allow-Credentials, so a cross-origin request
// that instead relies on cookies still gets none sent and reads nothing new.
const DESKTOP_CORS_HEADERS = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/task-list",
        destination: "/productivity/assignment",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // /:id matches one path segment, so this covers both
      // /api/assigned-tasks/reorder and /api/assigned-tasks/<real id> without
      // widening CORS to deeper routes desktop doesn't call (grab) — the
      // ones it does call (Submit, to-do editing) get their own entries below.
      { source: "/api/assigned-tasks/:id", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/assigned-tasks/:id/submissions", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/assigned-tasks/:id/submissions/upload-url", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/assigned-tasks/:id/todos", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/assigned-tasks/:id/todos/:todoId", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/project-messages", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/project-messages/:id/comments", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/conversations", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/conversations/:id", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/conversations/:id/messages", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/team-members", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/message-attachments", headers: DESKTOP_CORS_HEADERS },
      // Capture Now and the automatic 5-minute capture loop (desktop's
      // autoCapture.ts) both call these two — neither had ever gotten this
      // header, so every desktop call's *response* was likely unreadable in
      // the renderer even though the server-side upload/marker insert still
      // completed (the same silent-failure shape #210 found elsewhere).
      { source: "/api/upload-screenshot", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/screenshot-marker", headers: DESKTOP_CORS_HEADERS },
    ];
  },
};

export default nextConfig;
