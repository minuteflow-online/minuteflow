"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The centred tab switcher under the top bar — the same markup as the staff
 * ProductivitySubNav / MonitoringSubNav, for the client's own pages.
 */
export default function ClientSubNav({
  tabs,
}: {
  tabs: { label: string; href: string; exact?: boolean }[];
}) {
  const pathname = usePathname() ?? "";

  return (
    <div className="mb-6 flex justify-center">
      <nav className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
        {tabs.map((tab) => {
          const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                isActive ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
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
