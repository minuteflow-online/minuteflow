"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { BillingType } from "@/types/database";

const CATEGORIES = [
  { label: "Task", value: "Task" },
  { label: "Communication", value: "Communication" },
  { label: "Planning", value: "Planning" },
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
  new_task_client_memo?: string;
  billing_type?: BillingType;
  task_rate?: number | null;
  _isFixedTaskLog?: boolean;
}

interface ProjectTag {
  id: number;
  account: string | null;
  project_name: string;
  sort_order: number;
}

interface ProjectTask {
  id: number;
  task_library_id: number;
  task_name: string;
  billing_type?: BillingType;
  task_rate?: number | null;
}

interface TaskEntryFormProps {
  onStartTask: (data: TaskFormData) => void;
  hasActiveTask?: boolean;
  role?: string;
  sessionState?: "idle" | "clocked-in" | "on-break";
}

type WizardStep = "form" | "close-old" | "log-fixed";

export default function TaskEntryForm({ onStartTask, hasActiveTask = false, role = "va", sessionState = "idle" }: TaskEntryFormProps) {
  const isAdmin = role === "admin" || role === "manager";

  // ─── Form Fields ───
  const [account, setAccount] = useState("");
  const [project, setProject] = useState("");
  const [projectTagId, setProjectTagId] = useState<number | null>(null);
  const [taskName, setTaskName] = useState("");
  const [clientMemo, setClientMemo] = useState("");
  const [category, setCategory] = useState("Task");
  const [client, setClient] = useState("");
  const [selectedBillingType, setSelectedBillingType] = useState<BillingType>("hourly");
  const [selectedTaskRate, setSelectedTaskRate] = useState<number | null>(null);

  // ─── Cascading Data ───
  const [allAccounts, setAllAccounts] = useState<string[]>(FALLBACK_ACCOUNTS);
  const [allProjects, setAllProjects] = useState<ProjectTag[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<number, ProjectTask[]>>({});
  const [accountClientMap, setAccountClientMap] = useState<Record<string, string>>(FALLBACK_ACCOUNT_CLIENT_MAP);

  // ─── Idle-state filtering: before clock-in, only show fixed-rate paths ───
  const isIdle = sessionState === "idle";

  // Helper: does a project have at least one fixed task?
  const projectHasFixedTask = (pid: number) =>
    (tasksByProject[pid] ?? []).some((t) => t.billing_type === "fixed");

  // Accounts: when idle, only show accounts that have ≥1 project with a fixed task
  const filteredAccounts = isIdle
    ? allAccounts.filter((acct) =>
        allProjects.some((p) => p.account === acct && projectHasFixedTask(p.id))
      )
    : allAccounts;

  // Projects: filter by account, and when idle also require ≥1 fixed task
  const filteredProjects = allProjects.filter((p) => {
    if (p.account !== account) return false;
    if (isIdle && !projectHasFixedTask(p.id)) return false;
    return true;
  });

  // Tasks: when idle, only fixed tasks
  const allTasksForProject = projectTagId ? (tasksByProject[projectTagId] ?? []) : [];
  const filteredTasks = isIdle
    ? allTasksForProject.filter((t) => t.billing_type === "fixed")
    : allTasksForProject;

  // ─── Fetch cascading data ───
  const fetchFormOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/task-form-options");
      if (!res.ok) return;
      const data = await res.json();

      if (data.accounts?.length > 0) setAllAccounts(data.accounts);
      if (data.projects?.length > 0) setAllProjects(data.projects);
      if (data.tasksByProject) setTasksByProject(data.tasksByProject);
      if (data.clientMap && Object.keys(data.clientMap).length > 0) {
        setAccountClientMap(data.clientMap);
      }
    } catch {
      // Keep fallback values on error
    }
  }, []);

  useEffect(() => {
    fetchFormOptions();
  }, [fetchFormOptions]);

  // ─── Cascading resets ───
  // When account changes, reset project and task
  useEffect(() => {
    setProject("");
    setProjectTagId(null);
    setTaskName("");
    // Auto-map client
    if (account && accountClientMap[account]) {
      setClient(accountClientMap[account]);
    } else {
      setClient("");
    }
  }, [account, accountClientMap]);

  // When project changes, reset task
  useEffect(() => {
    setTaskName("");
  }, [projectTagId]);

  // ─── Prefill events from ProjectSidebar / DailyTaskPlanner ───
  useEffect(() => {
    function handlePrefill(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.account) setAccount(detail.account);
      if (detail.project) {
        setProject(detail.project);
        // Try to find the matching project_tag_id
        const match = allProjects.find(
          (p) => p.account === (detail.account || account) && p.project_name === detail.project
        );
        if (match) setProjectTagId(match.id);
      }
      if (detail.category) setCategory(detail.category);
      if (detail.task_name) setTaskName(detail.task_name);
      if (detail.client_memo) setClientMemo(detail.client_memo);
      if (detail.client_name) {
        setClient(detail.client_name);
      } else if (detail.account && accountClientMap[detail.account]) {
        setClient(accountClientMap[detail.account]);
      }
    }
    window.addEventListener("minuteflow-prefill", handlePrefill);
    return () => window.removeEventListener("minuteflow-prefill", handlePrefill);
  }, [accountClientMap, allProjects, account]);

  // ─── Auto-fill for Break ───
  useEffect(() => {
    if (category === "Break") {
      setAccount("Virtual Concierge");
      setClient("Toni Colina");
    }
  }, [category]);

  // ─── Close-old-task wizard state ───
  const [wizardStep, setWizardStep] = useState<WizardStep>("form");
  const [taskStatus, setTaskStatus] = useState<string>("");
  const [clientMemoText, setClientMemoText] = useState("");
  const [internalMemoText, setInternalMemoText] = useState("");
  const [showClientMemo, setShowClientMemo] = useState(false);
  const [showInternalMemo, setShowInternalMemo] = useState(false);

  // ─── Validation ───
  const [showValidation, setShowValidation] = useState(false);

  // ─── Form fill time tracking ───
  const formStartTimeRef = useRef<number | null>(null);
  const [formFillElapsed, setFormFillElapsed] = useState(0);

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

  // ─── Validation ───
  const getValidationErrors = (): string[] => {
    const errors: string[] = [];
    if (!taskName.trim()) errors.push("Task is required");
    if (!isPersonalOrBreak) {
      if (!account) errors.push("Account is required");
      if (!project.trim()) errors.push("Project is required");
    }
    return errors;
  };

  const isValid = getValidationErrors().length === 0;

  // ─── Start Task handler ───
  const handleStartTask = () => {
    setShowValidation(true);
    if (!isValid) return;

    const isFixedTask = selectedBillingType === "fixed";

    if (isFixedTask) {
      // Fixed tasks always show the wizard to collect status + memos for the NEW task
      setWizardStep("log-fixed");
    } else if (hasActiveTask) {
      setWizardStep("close-old");
    } else {
      submitTask("", "", "");
    }
  };

  // Submit after closing old task (hourly wizard)
  const handleCloseOldAndStart = () => {
    if (!taskStatus) return;
    if (!clientMemoText.trim() && !internalMemoText.trim()) return;
    submitTask(taskStatus, clientMemoText.trim(), internalMemoText.trim());
  };

  // Submit fixed task (memos + status go to the NEW task, not the old)
  const handleLogFixedTask = () => {
    if (!taskStatus) return;
    const formFillMs = formStartTimeRef.current
      ? Date.now() - formStartTimeRef.current
      : 0;

    onStartTask({
      task_name: taskName.trim(),
      category,
      account: isPersonalOrBreak && category === "Personal" ? "" : account,
      client_name: isPersonalOrBreak && category === "Personal" ? "" : client,
      project: project.trim(),
      // For fixed tasks: memos go to the NEW task
      client_memo: clientMemoText.trim() || clientMemo.trim(),
      internal_memo: internalMemoText.trim(),
      task_status: taskStatus || undefined,
      form_fill_ms: formFillMs,
      billing_type: "fixed",
      task_rate: selectedTaskRate,
      // Signal this is a fixed task log (dashboard uses this)
      _isFixedTaskLog: true,
    });

    // Reset everything
    setTaskName("");
    setCategory("Task");
    setAccount("");
    setClient("");
    setProject("");
    setProjectTagId(null);
    setClientMemo("");
    setSelectedBillingType("hourly");
    setSelectedTaskRate(null);
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

  // Final submit
  const submitTask = (status: string, closeClientMemo: string, closeInternalMemo: string) => {
    const formFillMs = formStartTimeRef.current
      ? Date.now() - formStartTimeRef.current
      : 0;

    // When closing an old task (wizard flow), memos go to the OLD task via client_memo/internal_memo.
    // The form's "Client Notes" field is for the NEW task — passed separately.
    // The dashboard's handleCheckAndStartTask uses task_status to decide which memo goes where:
    //   - If task_status is set → client_memo/internal_memo save to OLD task, new task gets no memo
    //   - If task_status is NOT set → client_memo goes to the NEW task
    // So when wizard is used, pass wizard memos as client_memo/internal_memo (for old task).
    // The form's clientMemo (Client Notes) won't be sent via this interface — it will need
    // the dashboard to handle it. For now, when no wizard, pass clientMemo as client_memo.
    onStartTask({
      task_name: taskName.trim(),
      category,
      account: isPersonalOrBreak && category === "Personal" ? "" : account,
      client_name: isPersonalOrBreak && category === "Personal" ? "" : client,
      project: project.trim(),
      client_memo: status ? closeClientMemo : (clientMemo.trim() || closeClientMemo),
      internal_memo: closeInternalMemo,
      task_status: status || undefined,
      form_fill_ms: formFillMs,
      // When wizard is used, carry the form's Client Notes to the NEW task separately
      new_task_client_memo: status ? (clientMemo.trim() || undefined) : undefined,
      billing_type: selectedBillingType,
      task_rate: selectedTaskRate,
    });

    // Reset everything
    setTaskName("");
    setCategory("Task");
    setAccount("");
    setClient("");
    setProject("");
    setProjectTagId(null);
    setClientMemo("");
    setSelectedBillingType("hourly");
    setSelectedTaskRate(null);
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
      case "Communication":
        return "bg-slate-blue text-white border border-slate-blue";
      case "Planning":
        return "bg-amber text-white border border-amber";
      case "Collaboration":
        return "bg-sage text-white border border-sage";
      case "Personal":
      case "Break":
        return "bg-walnut text-white border border-walnut";
      default:
        // "Task" and others
        return "bg-terracotta text-white border border-terracotta";
    }
  };

  const fieldError = (condition: boolean) =>
    showValidation && condition ? "border-red-400 bg-red-50/30" : "";

  // Handle project selection from dropdown
  const handleProjectChange = (value: string) => {
    if (!value) {
      setProject("");
      setProjectTagId(null);
      return;
    }
    const id = parseInt(value);
    const match = filteredProjects.find((p) => p.id === id);
    if (match) {
      setProject(match.project_name);
      setProjectTagId(match.id);
    }
  };

  // Handle task selection from dropdown
  const handleTaskChange = (value: string) => {
    if (!value) {
      setTaskName("");
      setSelectedBillingType("hourly");
      setSelectedTaskRate(null);
      return;
    }
    // value is the task_name directly
    setTaskName(value);
    // Look up billing_type and task_rate from the selected task
    const selectedTask = filteredTasks.find((t) => t.task_name === value);
    if (selectedTask) {
      setSelectedBillingType(selectedTask.billing_type || "hourly");
      setSelectedTaskRate(selectedTask.task_rate ?? null);
    }
  };

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

          {/* Non-billable info for Personal/Break */}
          {isPersonalOrBreak && (
            <div className="mb-3.5 p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
              {category === "Break"
                ? "Break time is billed to Virtual Concierge."
                : "Personal time is not billed to anyone."}
            </div>
          )}

          {/* ─── Row 1: Account + Project (side by side on wide, stacked on narrow) ─── */}
          {category !== "Personal" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5">
              {/* Account Dropdown */}
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
                  {filteredAccounts.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              {/* Project Dropdown (filtered by account) */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Project <span className="text-terracotta">*</span>
                </label>
                <select
                  value={projectTagId?.toString() ?? ""}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  onFocus={handleFormFieldFocus}
                  disabled={!account || category === "Break"}
                  className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] disabled:opacity-60 disabled:bg-parchment ${fieldError(!project.trim())}`}
                >
                  <option value="">
                    {!account ? "Select account first..." : "Select project..."}
                  </option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.id.toString()}>{p.project_name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ─── Row 2: Task + Client Notes (side by side on wide, stacked on narrow) ─── */}
          <div className={`grid gap-3 mb-3.5 ${isPersonalOrBreak ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
            {/* Task Dropdown (filtered by project) — or free text for Personal/Break */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Task <span className="text-terracotta">*</span>
              </label>
              {isIdle && !isPersonalOrBreak && filteredTasks.length === 0 ? (
                /* Before clock-in with no fixed tasks: show a disabled hint */
                <select
                  disabled
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-stone bg-parchment outline-none opacity-60"
                >
                  <option>No fixed tasks — clock in first</option>
                </select>
              ) : isPersonalOrBreak || filteredTasks.length === 0 ? (
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  onFocus={handleFormFieldFocus}
                  placeholder={isPersonalOrBreak ? "What are you doing?" : "Type a task..."}
                  className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone ${fieldError(!taskName.trim())}`}
                />
              ) : (
                <select
                  value={taskName}
                  onChange={(e) => handleTaskChange(e.target.value)}
                  onFocus={handleFormFieldFocus}
                  className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] ${fieldError(!taskName.trim())}`}
                >
                  <option value="">Select task...</option>
                  {filteredTasks.map((t) => (
                    <option key={t.id} value={t.task_name}>{t.task_name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Client Notes (free text — Today's Plan taps go here) */}
            {!isPersonalOrBreak && (
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Client Notes
                </label>
                <input
                  type="text"
                  value={clientMemo}
                  onChange={(e) => setClientMemo(e.target.value)}
                  onFocus={handleFormFieldFocus}
                  placeholder="Notes for this task..."
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
                />
              </div>
            )}
          </div>

          {/* ─── Row 3: Category Pills (default: Task) ─── */}
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

          {/* Validation errors */}
          {showValidation && !isValid && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
              {getValidationErrors().map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}

          {/* ─── Row 4: Start Activity button ─── */}
          <button
            onClick={handleStartTask}
            className="w-full flex items-center justify-center py-[11px] mt-2 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(194,105,79,0.25)]"
          >
            Start Activity
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

              {/* Memos */}
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

      {/* ─── Log Fixed Task Modal (status + memo for NEW task) ─── */}
      {wizardStep === "log-fixed" && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-espresso">Log Fixed Task</h3>
                <p className="text-[11px] text-stone mt-0.5">
                  {taskName} &middot; {account}
                </p>
              </div>
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

              {/* Memos */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Add Comments <span className="text-stone font-normal">(optional)</span>
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
                  onClick={handleLogFixedTask}
                  disabled={!taskStatus}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Log Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
