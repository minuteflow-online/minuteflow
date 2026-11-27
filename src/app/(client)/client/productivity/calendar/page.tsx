"use client";

// The same Calendar staff use (Month / Week / Day / Range, categories,
// teammate picker). It recognises a client login and shows only their own
// team's tasks — see the client-mode notes in the staff page.
import ProductivityCalendarPage from "@/app/(app)/productivity/calendar/page";

export default function ClientCalendarPage() {
  return <ProductivityCalendarPage />;
}
