import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Shared helpers for /api/internal/* — Regie-only PIN-gated data access,
// service-role (bypasses RLS) instead of a user session, since Regie has
// no MinuteFlow login. Never used for anything client-facing; every route
// here re-checks the PIN header itself (no shared middleware relied on).
const INTERNAL_REVIEW_PIN = "9876";

export function checkInternalPin(request: NextRequest): NextResponse | null {
  // Header is used by fetch() calls; query param exists only so plain <img
  // src> tags (which can't set custom headers) can also pass the PIN, for
  // the drive-image thumbnail route.
  const headerPin = request.headers.get("x-internal-review-pin");
  const queryPin = request.nextUrl.searchParams.get("pin");
  if (headerPin !== INTERNAL_REVIEW_PIN && queryPin !== INTERNAL_REVIEW_PIN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Filenames look like ..._2026-07-23_12-16-50-842.png — the trailing segment
// is the true client-side capture time. created_at has a confirmed 2-4s
// upload lag and must not be used for ordering/precision.
export function captureTimeFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})\.png$/);
  if (!m) return null;
  const [, date, hh, mm, ss, ms] = m;
  return new Date(`${date}T${hh}:${mm}:${ss}.${ms}Z`).toISOString();
}
