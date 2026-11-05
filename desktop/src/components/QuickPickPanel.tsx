// Ported from the web dashboard's ProjectSidebar ("Quick Pick") — same
// three buttons, same styling (className strings lifted directly), same
// card shell ClockPanel/TeamPanel already use. Web's version also takes an
// onQuickAction prop for pre-filling the freeform task entry form, but
// desktop has no such form (tasks come from assignments), so only the
// quick-switch action applies here.
import type { QuickMessageMapping } from "../lib/clock";

interface QuickPickPanelProps {
  onQuickSwitch: (mapping: QuickMessageMapping) => void;
  disabled: boolean;
}

export default function QuickPickPanel({ onQuickSwitch, disabled }: QuickPickPanelProps) {
  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Quick Pick</h3>
      <div className="space-y-2">
        <div className="text-[9px] font-bold text-bark uppercase tracking-wider mb-2">
          Quick Actions
        </div>
        <button
          onClick={() =>
            onQuickSwitch({
              category: "Planning",
              task_name: "Planning/Sorting",
              account: "Virtual Concierge",
              project: "Set-up",
              client_name: "Toni Colina",
            })
          }
          disabled={disabled}
          className="w-full py-3 px-4 rounded-xl bg-amber text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-amber/90 text-left leading-tight disabled:opacity-50 disabled:cursor-not-allowed"
        >
          🗂️ Planning/Sorting
        </button>
        <button
          onClick={() =>
            onQuickSwitch({
              category: "Communication",
              task_name: "Message for Guidance/Instructions",
              account: "Virtual Concierge",
              project: "Supervision",
              client_name: "Toni Colina",
            })
          }
          disabled={disabled}
          className="w-full py-3 px-4 rounded-xl bg-slate-blue text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#4a5568] text-left leading-tight disabled:opacity-50 disabled:cursor-not-allowed"
        >
          💬 Message for Guidance/Instructions
        </button>
        <button
          onClick={() =>
            onQuickSwitch({
              category: "Communication",
              task_name: "General Message",
              account: "Virtual Concierge",
              project: "Supervision",
              client_name: "Toni Colina",
            })
          }
          disabled={disabled}
          className="w-full py-3 px-4 rounded-xl bg-terracotta-soft text-terracotta text-[12px] font-semibold cursor-pointer transition-all hover:bg-terracotta hover:text-white text-left leading-tight border border-terracotta/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          📨 General Message
        </button>
      </div>
    </div>
  );
}
