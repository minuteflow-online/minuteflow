"use client";

// The same Objective screen staff use. A client login only ever reaches its
// own org's objectives — see the client branches in /api/projects and
// canAccessProject (src/lib/projectAccess.ts).
import ProductivityObjectivePage from "@/app/(app)/productivity/objective/page";

export default function ClientObjectivePage() {
  return <ProductivityObjectivePage />;
}
