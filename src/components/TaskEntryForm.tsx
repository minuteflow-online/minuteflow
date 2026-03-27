"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const CATEGORIES = [
  { label: "Task", value: "Task" },
  { label: "Message", value: "Message" },
  { label: "Meeting", value: "Meeting" },
  { label: "Sorting Tasks", value: "Sorting Tasks" },
  { label: "Collaboration", value: "Collaboration" },
  { label: "Personal", value: "Personal" },
  { label: "Break", value: "Break" },
];

// Hardcoded fallbacks in case DB fetch fails
const FALLBACK_ACCOUNTS = [
  "TAT Foundation",
  "WSB Awesome Team",
  "Virtual Concierge",
  "Colina Portrait",
  "SNAPS Sublimation",
  "Thess Personal",
  "Thess Base",
  "Right Path Agency",
  "Personal",
  "Quad Life",
  "TONIWSB",
];

const FALLBACK_CLIENTS = [
  "Ting Chiu",
  "Thess Peters",
  "Toni Colina",
  "Self",
  "Gary Yip",
  "Gloria Flores",
];

const FALLBACK_ACCOUNT_CLIENT_MAP: Record<string, string> = {
  "TAT Foundation": "Ting Chiu",
  "WSB Awesome Team": "Ting Chiu",
  TONIWSB: "Toni Colina",
  "Virtual Concierge": "Toni Colina",
  "Thess Personal": "Thess Peters",
  "Thess Base": "Thess Peters",
  "Colina Portrait": "Toni Colina",
  "Right Path Agency": "Gary Yip",
};

export interface TaskFormData {
  task_name: string;
  category: string;
  account: string;
  client_name: string;
  project: string;
  client_memo: string;
  internal_memo: string;
  task_status?: string;
  form_fill_ms?: number;
}

interface TaskEntryFormProps {
  onStartTask: (data: TaskFormData) => void;
  hasActiveTask?: boolean;
  role?: string;
}

type WizardStep = "form" | "close-old";

export default function TaskEntryForm({ onStartTask, hasActiveTask = false, role = "va" }: TaskEntryFormProps) {
  const isAdmin = role === "admin" || role === "manager";
  const [taskName, setTaskName] = useState("");
  const [category, setCategory] = useState("Task");
  const [account, setAccount] = useState("");
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");

  // Dynamic accounts/clients from DB
  const [dbAccounts, setDbAccounts] = useState<string[]>(FALLBACK_ACCOUNTS);
  const [dbClients, setDbClients] = useState<string[]>(FALLBACK_CLIENTS);
  const [accountClientMap, setAccountClientMap] = useState<Record<string, string>>(FALLBACK_ACCOUNT_CLIENT_MAP);

  const fetchAccountsAndClients = useCallback(async () => {
    try {
      const [accRes, cliRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/clients"),
      ]);
      if (accRes.ok && cliRes.ok) {
        const accData = await accRes.json();
        const cliData = await cliRes.json();

        // Only use active accounts/clients
        const activeAccounts = (accData.accounts ?? [])
          .filter((a: { active: boolean }) => a.active)
          .map((a: { name: string }) => a.name);
        const activeClients = (cliData.clients ?? [])
          .filter((c: { active: boolean }) => c.active)
          .map((c: { name: string }) => c.name);

        if (activeAccounts.length > 0) setDbAccounts(activeAccounts);
        if (activeClients.length > 0) setDbClients(activeClients);

        // Build account-client map from mappings
        const mappings = accData.mappings ?? [];
        const newMap: Record<string, string> = {};
        for (const m of mappings) {
          if (m.clients) {
            const acc = (accData.accounts ?? []).find(
              (a: { id: number }) => a.id === m.account_id
            );
            if (acc) {
              newMap[acc.name] = m.clients.name;
            }
          }
        }
        if (Object.keys(newMap).length > 0) setAccountClientMap(newMap);
      }
    } catch {
      // Keep fallback values on error
    }
  }, []);

  useEffect(() => {
    fetchAccountsAndClients();
  }, [fetchAccountsAndClients]);

  // Listen for prefill events from ProjectSidebar
  useEffect(() => {
    function handlePrefill(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.account) setAccount(detail.account);
      if (detail.project) setProject(detail.project);
      if (detail.category) setCategory(detail.category);
      if (detail.task_name) setTaskName(detail.task_name);
      // Use explicit client_name if provided, otherwise auto-select based on account
      if (detail.client_name) {
        setClient(detail.client_name);
      } else if (detail.account && accountClientMap[detail.account]) {
        setClient(accountClientMap[detail.account]);
      }
    }
    window.addEventListener("minuteflow-prefill", handlePrefill);
    return () => window.removeEventListener("minuteflow-prefill", handlePrefill);
  }, [accountClientMap]);

  // Close-old-task wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>("form");
  const [taskStatus, setTaskStatus] = useState<string>("");
  const [clientMemoText, setClientMemoText] = useState("");
  const [internalMemoText, setInternalMemoText] = useState("");
  const [showClientMemo, setShowClientMemo] = useState(false);
  const [showInternalMemo, setShowInternalMemo] = useState(false);

  // Validation
  const [showValidation, setShowValidation] = useState(false);

  // Form fill time tracking
  const formStartTimeRef = useRef<number | null>(null);
  const [formFillElapsed, setFormFillElapsed] = useState(0);

  // Live timer for admin view
  useEffect(() => {
    if (!isAdmin || !formStartTimeRef.current) return;
    const interval = setInterval(() => {
      if (formStartTimeRef.current) {
        setFormFillElapsed(Math.floor((Date.now() - formStartTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isAdmin, formFillElapsed]);

  const handleFormFieldFocus = () => {
    if (formStartTimeRef.current === null) {
      formStartTimeRef.current = Date.now();
      setFormFillElapsed(0);
    }
  };

  const isPersonalOrBreak = category === "Personal" || category === "Break";

  // Auto-map account to client
  useEffect(() => {
    if (account && accountClientMap[account]) {
      setClient(accountClientMap[account]);
    }
  }, [account, accountClientMap]);

  // Auto-fill account for Break
  useEffect(() => {
    if (category === "Break") {
      setAccount("Virtual Concierge");
      setClient("Toni Colina");
    }
  }, [category]);

  // Validate required fields
  const getValidationErrors = (): string[] => {
    const errors: string[] = [];
    if (!taskName.trim()) errors.push("Task Name is required");
    if (!isPersonalOrBreak) {
      if (!account) errors.push("Account is required");
      if (!project.trim()) errors.push("Project is required");
    }
    return errors;
  };

  const isValid = getValidationErrors().length === 0;

  // User clicks "Start Task"
  const handleStartTask = () => {
    setShowValidation(true);
    if (!isValid) return;

    if (hasActiveTask) {
      // Need to close the old task first — show status/memo modal
      // Auto-expand memos for Meeting category
      if (category === "Meeting") {
        setShowClientMemo(true);
        setShowInternalMemo(true);
      }
      setWizardStep("close-old");
    } else {
      // No active task — start directly
      submitTask("", "", "");
    }
  };

  // Submit after closing old task — status required, at least one memo required
  const handleCloseOldAndStart = () => {
    if (!taskStatus) return;
    if (!clientMemoText.trim() && !internalMemoText.trim()) return;
    submitTask(
      taskStatus,
      clientMemoText.trim(),
      internalMemoText.trim()
    );
  };

  // Final submit
  const submitTask = (status: string, clientMemo: string, internalMemo: string) => {
    const formFillMs = formStartTimeRef.current
      ? Date.now() - formStartTimeRef.current
      : 0;

    onStartTask({
      task_name: taskName.trim(),
      category,
      account: isPersonalOrBreak && category === "Personal" ? "" : account,
      client_name: isPersonalOrBreak && category === "Personal" ? "" : client,
      project: project.trim(),
      client_memo: clientMemo,
      internal_memo: internalMemo,
      task_status: status || undefined,
      form_fill_ms: formFillMs,
    });
    // Reset everything
    setTaskName("");
    setCategory("Task");
    setAccount("");
    setClient("");
    setProject("");
    setWizardStep("form");
    setTaskStatus("");
    setClientMemoText("");
    setInternalMemoText("");
    setShowClientMemo(false);
    setShowInternalMemo(false);
    setShowValidation(false);
    formStartTimeRef.current = null;
    setFormFillElapsed(0);
  };

  const cancelWizard = () => {
    setWizardStep("form");
    setTaskStatus("");
    setClientMemoText("");
    setInternalMemoText("");
    setShowClientMemo(false);
    setShowInternalMemo(false);
  };

  const categoryChipColor = (cat: string, isActive: boolean): string => {
    if (!isActive) {
      return "border border-sand bg-white text-bark hover:border-terracotta hover:text-terracotta";
    }
    switch (cat) {
      case "Message":
        return "bg-slate-blue text-white border border-slate-blue";
      case "Meeting":
        return "bg-clay-rose text-white border border-clay-rose";
      case "Sorting Tasks":
        return "bg-amber text-white border border-amber";
      case "Collaboration":
        return "bg-sage text-white border border-sage";
      case "Personal":
      case "Break":
        return "bg-walnut text-white border border-walnut";
      default:
        return "bg-terracotta text-white border border-terracotta";
    }
  };

  const fieldError = (condition: boolean) =>
    showValidation && condition ? "border-red-400 bg-red-50/30" : "";

  return (
    <>
      <div className="bg-white border border-sand rounded-xl" data-task-form>
        <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
          <h3 className="text-sm font-bold text-espresso">Log a Task</h3>
          {isAdmin && formStartTimeRef.current && formFillElapsed > 0 && (
            <span className="text-[11px] font-semibold text-walnut bg-walnut/10 px-2 py-0.5 rounded-full tabular-nums">
              ⏱ {Math.floor(formFillElapsed / 60)}:{(formFillElapsed % 60).toString().padStart(2, "0")} wizard time
            </span>
          )}
        </div>
        <div className="p-[18px_20px]">
          {/* Task Name */}
          <div className="mb-3.5">
            <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
              Task Name <span className="text-terracotta">*</span>
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              onFocus={handleFormFieldFocus}
              placeholder="What are you working on?"
              className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone ${fieldError(!taskName.trim())}`}
            />
          </div>

          {/* Category Chips */}
          <div className="mb-3.5">
            <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`py-1.5 px-3.5 rounded-full text-xs font-medium cursor-pointer transition-all ${categoryChipColor(cat.value, category === cat.value)}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Non-billable info */}
          {isPersonalOrBreak && (
            <div className="mb-3.5 p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
              {category === "Break"
                ? "Break time is billed to Virtual Concierge."
                : "Personal time is not billed to anyone."}
            </div>
          )}

          {/* Account & Client — hidden for Personal, auto-filled for Break */}
          {category !== "Personal" && (
            <div className="grid grid-cols-2 gap-3 mb-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Account <span className="text-terracotta">*</span>
                </label>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onFocus={handleFormFieldFocus}
                  disabled={category === "Break"}
                  className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] disabled:opacity-60 disabled:bg-parchment ${fieldError(!account)}`}
                >
                  <option value="">Select account...</option>
                  {dbAccounts.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Client
                </label>
                <select
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  disabled={category === "Break"}
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] disabled:opacity-60 disabled:bg-parchment"
                >
                  <option value="">Select client...</option>
                  {dbClients.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Project */}
          {!isPersonalOrBreak && (
            <div className="mb-3.5">
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Project <span className="text-terracotta">*</span>
              </label>
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                onFocus={handleFormFieldFocus}
                placeholder="e.g. Website Redesign"
                className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone ${fieldError(!project.trim())}`}
              />
            </div>
          )}

          {/* Validation errors */}
          {showValidation && !isValid && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
              {getValidationErrors().map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}

          {/* Start Task button */}
          <button
            onClick={handleStartTask}
            className="w-full flex items-center justify-center py-[11px] mt-2 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(194,105,79,0.25)]"
          >
            Start Task
          </button>
        </div>
      </div>

      {/* ─── Close Old Task Modal (status + memo) ─── */}
      {wizardStep === "close-old" && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Close Current Task</h3>
              <button onClick={cancelWizard} className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer">&times;</button>
            </div>
            <div className="p-5">
              {/* Task Status */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Task Status</p>
                <div className="flex gap-2">
                  {["In Progress", "Completed", "On Hold"].map((status) => (
                    <button
                      key={status}
                      onClick={() => setTaskStatus(status)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        taskStatus === status
                          ? status === "Completed"
                            ? "bg-sage text-white border border-sage"
                            : status === "On Hold"
                            ? "bg-amber text-white border border-amber"
                            : "bg-terracotta text-white border border-terracotta"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memos — both can be filled independently */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Add Comments <span className="text-stone font-normal">(at least one required)</span>
                </p>

                {/* Client Memo */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowClientMemo(!showClientMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showClientMemo || clientMemoText
                        ? "bg-slate-blue text-white border border-slate-blue"
                        : "border border-slate-blue/30 bg-slate-blue-soft text-slate-blue hover:border-slate-blue"
                    }`}
                  >
                    <span>Client Memo</span>
                    <span className="text-[10px] opacity-75">
                      {clientMemoText ? "filled" : showClientMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showClientMemo && (
                    <textarea
                      value={clientMemoText}
                      onChange={(e) => setClientMemoText(e.target.value)}
                      placeholder="Notes visible to the client..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-slate-blue focus:shadow-[0_0_0_3px_rgba(100,116,139,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>

                {/* Internal Memo */}
                <div>
                  <button
                    onClick={() => setShowInternalMemo(!showInternalMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showInternalMemo || internalMemoText
                        ? "bg-walnut text-white border border-walnut"
                        : "border border-walnut/30 bg-amber-soft text-walnut hover:border-walnut"
                    }`}
                  >
                    <span>Internal Memo</span>
                    <span className="text-[10px] opacity-75">
                      {internalMemoText ? "filled" : showInternalMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showInternalMemo && (
                    <textarea
                      value={internalMemoText}
                      onChange={(e) => setInternalMemoText(e.target.value)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-walnut focus:shadow-[0_0_0_3px_rgba(93,75,60,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={cancelWizard}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseOldAndStart}
                  disabled={!taskStatus || (!clientMemoText.trim() && !internalMemoText.trim())}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Close &amp; Start New Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
