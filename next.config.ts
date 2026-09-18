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
      // widening CORS to the deeper routes (todos, grab, etc.) desktop
      // doesn't call.
      { source: "/api/assigned-tasks/:id", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/project-messages", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/project-messages/:id/comments", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/conversations", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/conversations/:id/messages", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/team-members", headers: DESKTOP_CORS_HEADERS },
      { source: "/api/message-attachments", headers: DESKTOP_CORS_HEADERS },
    ];
  },
};

export default nextConfig;
