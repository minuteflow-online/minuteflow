"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import VAProjectsTab from "@/components/VAProjectsTab";
import type { UserRole } from "@/types/database";

type TeamMember = { id: string; full_name: string; username: string };

export default function ProductivityObjectivePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("va");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setReady(true);
        return;
      }
      setUserId(user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole((profile?.role as UserRole) || "va");
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  if (!ready || !userId) {
    return <div className="p-8 text-center text-xs text-stone">Loading…</div>;
  }

  return (
    <VAProjectsTab kind="objective" activeProfiles={teamMembers} currentUserId={userId} isAdmin={hasBroadAdminAccess({ role })} />
  );
}
