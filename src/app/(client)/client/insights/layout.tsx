import ClientSubNav from "@/components/ClientSubNav";

// Same shape as the staff Insights area (Report / Time Log switcher).
export default function ClientInsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ClientSubNav
        tabs={[
          { label: "Report", href: "/client/insights", exact: true },
          { label: "Time Log", href: "/client/insights/timelog" },
        ]}
      />
      {children}
    </div>
  );
}
