import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import {
  generateOccurrences,
  orgToday,
  orgTimezone,
  type GeneratableTemplate,
} from "@/lib/recurringTasks";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getCronSecret(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return false;
  }
  return true;
}

// The nightly top-up. It used to build exactly one day of work — tomorrow —
// and nothing else existed, which is why a template produced nothing the day
// you created it and why the Calendar went blank past tomorrow. It now runs
// the same generator the template save runs, keeping every template two
// occurrences deep. Generation is keyed by (template, due_date), so the nights
// where nothing has come due yet create nothing.
async function handleCron(request: NextRequest) {
  if (!getCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  const timeZone = await orgTimezone(supabase);
  const today = orgToday(timeZone);

  const { data: templates, error: templateError } = await supabase
    .from("recurring_task_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (templateError) {
    return Response.json({ error: templateError.message }, { status: 500 });
  }

  try {
    const result = await generateOccurrences(supabase, (templates ?? []) as GeneratableTemplate[], today);
    return Response.json({
      created: result.created,
      skipped: result.skipped,
      templates: (templates ?? []).length,
      from: today,
      dates: result.dates,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
