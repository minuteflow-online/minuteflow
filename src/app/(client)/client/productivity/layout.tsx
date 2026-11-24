import ClientSubNav from "@/components/ClientSubNav";

// Same shape as the staff Productivity area: a centred tab switcher, then
// the tab's page.
export default function ClientProductivityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ClientSubNav
        tabs={[
          { label: "Assignment", href: "/client/productivity/assignment" },
          { label: "Submissions", href: "/client/productivity/submissions" },
          { label: "Calendar", href: "/client/productivity/calendar" },
        ]}
      />
      {children}
    </div>
  );
}
