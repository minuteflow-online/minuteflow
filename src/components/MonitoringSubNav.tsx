"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Props = {
  /** Hide the Team tab for plain VA accounts, matching TopNav's old /team gating. */
  showTeam: boolean;
};

export default function MonitoringSubNav({ showTeam }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportTab = searchParams.get("tab");

  const tabs = [
    { label: "Report", href: "/reports", isActive: pathname === "/reports" && reportTab !== "progress" },
    { label: "Progress", href: "/reports?tab=progress", isActive: pathname === "/reports" && reportTab === "progress" },
    { label: "Time Log", href: "/timelog", isActive: pathname.startsWith("/timelog") },
    ...(showTeam ? [{ label: "Team", href: "/team", isActive: pathname.startsWith("/team") }] : []),
  ];

  return (
    <div className="mb-6 flex justify-center">
      <nav className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab.isActive
                ? "bg-white text-espresso shadow-sm"
                : "text-stone hover:text-espresso"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
