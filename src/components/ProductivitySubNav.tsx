"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Assignment", href: "/productivity/assignment" },
  { label: "Submissions", href: "/productivity/submissions" },
  { label: "Calendar", href: "/productivity/calendar" },
  { label: "Objective", href: "/productivity/objective" },
  { label: "Operations", href: "/productivity/operations" },
];

export default function ProductivitySubNav() {
  const pathname = usePathname();

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
