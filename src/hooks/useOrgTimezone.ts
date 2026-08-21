"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The organization's timezone, for components that need it outside SessionProvider.
 *
 * Every date and time in MinuteFlow is shown in org time, never the viewer's local
 * time, so a component that guesses gets it wrong for anyone travelling or abroad.
 * SessionContext already carries this for pages under (app), but the admin panel
 * renders outside that provider — this covers both.
 *
 * The answer is cached at module scope: it changes about never, and without the
 * cache every mount of a shared component would re-query it.
 */
let cached: string | null = null;
let inFlight: Promise<string> | null = null;

async function loadOrgTimezone(): Promise<string> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const { data } = await createClient()
          .from("organization_settings")
          .select("timezone")
          .limit(1)
          .single();
        cached = data?.timezone || "UTC";
      } catch {
        // Unreachable settings row is not worth failing a render over; UTC at
        // least renders a time, and the next mount retries.
        cached = "UTC";
        inFlight = null;
      }
      return cached ?? "UTC";
    })();
  }
  return inFlight;
}

export function useOrgTimezone(override?: string): string {
  const [fetched, setFetched] = useState<string | null>(cached);

  useEffect(() => {
    // A caller that already has the timezone is returned it directly below, so
    // there is nothing to load and no state to set.
    if (override) return;
    let active = true;
    loadOrgTimezone().then((tz) => {
      if (active) setFetched(tz);
    });
    return () => {
      active = false;
    };
  }, [override]);

  return override ?? fetched ?? "UTC";
}
