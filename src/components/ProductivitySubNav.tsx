"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

const BASE_TABS = [
  { label: "Assignment", href: "/productivity/assignment" },
  { label: "Submissions", href: "/productivity/submissions" },
  { label: "Calendar", href: "/productivity/calendar" },
  { label: "Objective", href: "/productivity/objective" },
  { label: "Operations", href: "/productivity/operations" },
];
// Admin-only: the company-wide Assets view (Toni's call, 2026-11-11). The
// Docs & Files tab nested inside each Objective/Operation stays visible to
// everyone regardless — this is a separate, additional overview, not a
// replacement.
const ADMIN_TABS = [{ label: "Assets", href: "/productivity/assets" }];

export default function ProductivitySubNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(hasBroadAdminAccess(profile));
    })();
  }, []);

  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;

  return (
    <div className="mb-6 flex justify-center">
      <nav className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-white text-espresso shadow-sm"
                  : "text-stone hover:text-espresso"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
