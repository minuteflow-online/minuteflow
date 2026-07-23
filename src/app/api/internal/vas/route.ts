import { NextRequest, NextResponse } from "next/server";
import { checkInternalPin, serviceClient } from "../_internalAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = checkInternalPin(request);
  if (denied) return denied;

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, position")
    .order("full_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vas: data });
}
