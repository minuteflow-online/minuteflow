import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import ClientHeaderActions from "@/components/ClientHeaderActions";
import ClientMainFrame from "@/components/ClientMainFrame";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // This view is for clients only — everyone else belongs in the staff app.
  if (profile?.role !== "client") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-sand bg-white px-6 py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="font-serif text-xl font-bold text-ink">
              Minute<span className="italic text-terracotta">Flow</span>
            </h1>
            <nav className="flex items-center gap-1">
              <Link
                href="/client"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-bark hover:bg-parchment hover:text-espresso transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/client/productivity"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-bark hover:bg-parchment hover:text-espresso transition-colors"
              >
                Productivity
              </Link>
              <Link
                href="/client/insights"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-bark hover:bg-parchment hover:text-espresso transition-colors"
              >
                Insights
              </Link>
              <Link
                href="/client/admin"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-bark hover:bg-parchment hover:text-espresso transition-colors"
              >
                Admin
              </Link>
              <Link
                href="/client/portal"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-bark hover:bg-parchment hover:text-espresso transition-colors"
              >
                Portal
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ClientHeaderActions />
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm font-medium text-bark hover:text-terracotta hover:underline"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>
      <ClientMainFrame>{children}</ClientMainFrame>
    </div>
  );
}
