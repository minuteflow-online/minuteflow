import { createClient } from "@/lib/supabase/server";
import MonitoringSubNav from "@/components/MonitoringSubNav";

export default async function MonitoringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let showTeam = true;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department")
      .eq("id", user.id)
      .single();
    const isITStaff = profile?.department?.trim().toUpperCase() === "IT";
    showTeam = profile?.role !== "va" || isITStaff;
  }

  return (
    <div>
      <MonitoringSubNav showTeam={showTeam} />
      {children}
    </div>
  );
}
