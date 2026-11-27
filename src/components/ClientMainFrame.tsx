"use client";

import { usePathname } from "next/navigation";

/**
 * The client area's page frame. Every client page sits in the centred
 * column, except the client Admin page, which runs edge to edge with its own
 * sidebar — the same shell as the real Admin panel.
 */
export default function ClientMainFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname?.startsWith("/client/admin");

  return (
    <main className={fullBleed ? "w-full flex-1" : "mx-auto w-full max-w-7xl flex-1 px-6 py-8"}>
      {children}
    </main>
  );
}
