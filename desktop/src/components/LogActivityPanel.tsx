// Simplified port of web's TaskEntryForm ("Log an Activity") — hourly path
// only, no fixed-pay billing or task-library autocomplete (Task is free
// text here; see taskForm.ts). Field layout, category chip colors, and the
// "Close Current Task" wizard are lifted from that component's classes.
import { useEffect, useState } from "react";
import {
  CATEGORIES,
  ACCOUNT_CLIENT_MAP,
  FALLBACK_ACCOUNTS,
  CLIENT_MEMO_WORD_LIMIT,
  countWords,
  limitToWords,
  fetchProjectTags,
  type ProjectTag,
} from "../lib/taskForm";
import type { AdHocTaskInput, CloseOldTaskInput } from "../lib/clock";

interface LogActivityPanelProps {
  hasActiveTask: boolean;
  submitting: boolean;
  onSubmit: (input: AdHocTaskInput, closeOld?: CloseOldTaskInput) => void;
}

function categoryChipColor(cat: string, isActive: boolean): string {
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
      return "bg-terracotta text-white border border-terracotta";
  }
}

export default function LogActivityPanel({ hasActiveTask, submitting, onSubmit }: LogActivityPanelProps) {
  const [projectTags, setProjectTags] = useState<ProjectTag[]>([]);

  useEffect(() => {
    fetchProjectTags().then((rows) => {
      if (rows.length > 0) setProjectTags(rows);
    });
  }, []);

  const accounts =
    projectTags.length > 0 ? Array.from(new Set(projectTags.map((p) => p.account))) : FALLBACK_ACCOUNTS;

  const [account, setAccount] = useState("");
  const [project, setProject] = useState("");
  const [taskName, setTaskName] = useState("");
  const [clientMemo, setClientMemo] = useState("");
  const [category, setCategory] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  const isPersonalOrBreak = category === "Personal" || category === "Break";
  const filteredProjects = projectTags.filter((p) => p.account === account);

  useEffect(() => {
    setProject("");
  }, [account]);

  // Auto-fill for Break, same as web.
  useEffect(() => {
    if (category === "Break") setAccount("Virtual Concierge");
  }, [category]);

  const validationErrors: string[] = [];
  if (!taskName.trim()) validationErrors.push("Task is required");
  if (!category || category === "Task") validationErrors.push("Category is required");
  if (!isPersonalOrBreak) {
    if (!account) validationErrors.push("Account is required");
    if (!project.trim()) validationErrors.push("Project is required");
  }
  const isValid = validationErrors.length === 0;
  const fieldError = (condition: boolean) => (showValidation && condition ? "border-red-400 bg-red-50/30" : "");

  // ─── Close Current Task wizard ───
  const [wizardOpen, setWizardOpen] = useState(false);
  const [taskStatus, setTaskStatus] = useState<"In Progress" | "Completed" | "On Hold" | "">("");
  const [closeClientMemo, setCloseClientMemo] = useState("");
  const [closeInternalMemo, setCloseInternalMemo] = useState("");
  const [showClientMemoBox, setShowClientMemoBox] = useState(false);
  const [showInternalMemoBox, setShowInternalMemoBox] = useState(false);

  function resetForm() {
    setTaskName("");
    setCategory("");
    setAccount("");
    setProject("");
    setClientMemo("");
    setShowValidation(false);
  }

  function resetWizard() {
    setWizardOpen(false);
    setTaskStatus("");
    setCloseClientMemo("");
    setCloseInternalMemo("");
    setShowClientMemoBox(false);
    setShowInternalMemoBox(false);
  }

  function handleStart() {
    setShowValidation(true);
    if (!isValid) return;
    if (hasActiveTask) {
      setWizardOpen(true);
      return;
    }
    submit();
  }

  function submit(closeOld?: CloseOldTaskInput) {
    const client = isPersonalOrBreak ? "" : (ACCOUNT_CLIENT_MAP[account] ?? "");
    onSubmit(
      {
        task_name: taskName.trim(),
        category,
        account: category === "Personal" ? "" : account,
        project: isPersonalOrBreak ? "" : project.trim(),
        client_name: category === "Personal" ? "" : client,
        client_memo: clientMemo.trim(),
      },
      closeOld
    );
    resetForm();
    resetWizard();
  }

  function handleCloseOldAndStart() {
    if (!taskStatus) return;
    if (!closeClientMemo.trim() && !closeInternalMemo.trim()) return;
    submit({ status: taskStatus, clientMemo: closeClientMemo, internalMemo: closeInternalMemo });
  }

  return (
    <>
      <div className="space-y-3.5">
        {isPersonalOrBreak && (
          <div className="p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
            {category === "Break"
              ? "Break time is billed to Virtual Concierge."
              : "Personal time is not billed to anyone."}
          </div>
        )}

        {category !== "Personal" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Account <span className="text-terracotta">*</span>
              </label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                disabled={category === "Break"}
                className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta disabled:opacity-60 disabled:bg-parchment ${fieldError(!account)}`}
              >
                <option value="">Select account...</option>
                {accounts.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Project <span className="text-terracotta">*</span>
              </label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                disabled={!account || category === "Break"}
                className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta disabled:opacity-60 disabled:bg-parchment ${fieldError(!project.trim())}`}
              >
                <option value="">{!account ? "Select account first..." : "Select project..."}</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.project_name}>{p.project_name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className={`grid gap-3 ${isPersonalOrBreak ? "grid-cols-1" : "grid-cols-2"}`}>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
              Task <span className="text-terracotta">*</span>
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder={isPersonalOrBreak ? "What are you doing?" : "Type a task..."}
              className={`w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta placeholder:text-stone ${fieldError(!taskName.trim())}`}
            />
          </div>
          {!isPersonalOrBreak && (
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Client Notes
              </label>
              <input
                type="text"
                value={clientMemo}
                onChange={(e) => setClientMemo(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
                placeholder="Notes for this task..."
                className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta placeholder:text-stone"
              />
              <p className="text-[10px] text-stone mt-1">
                {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(clientMemo))} words remaining
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                disabled={cat.disabled}
                title={cat.disabled ? "Not available here" : undefined}
                className={
                  cat.disabled
                    ? "py-1.5 px-3.5 rounded-full text-xs font-medium border border-sand bg-parchment text-stone opacity-60 cursor-not-allowed"
                    : `py-1.5 px-3.5 rounded-full text-xs font-medium cursor-pointer transition-all ${categoryChipColor(cat.value, category === cat.value)}`
                }
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {showValidation && !isValid && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
            {validationErrors.map((err) => (
              <div key={err}>{err}</div>
            ))}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={submitting}
          className="w-full flex items-center justify-center py-[11px] rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Activity
        </button>
      </div>

      {wizardOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Close Current Task</h3>
              <button onClick={resetWizard} className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer">&times;</button>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Task Status</p>
                <div className="flex gap-2">
                  {(["In Progress", "Completed", "On Hold"] as const).map((status) => (
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

              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Add Comments <span className="text-stone font-normal">(at least one required)</span>
                </p>
                <div className="mb-3">
                  <button
                    onClick={() => setShowClientMemoBox(!showClientMemoBox)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showClientMemoBox || closeClientMemo
                        ? "bg-slate-blue text-white border border-slate-blue"
                        : "border border-slate-blue/30 bg-slate-blue-soft text-slate-blue hover:border-slate-blue"
                    }`}
                  >
                    <span>Client Memo</span>
                    <span className="text-[10px] opacity-75">
                      {closeClientMemo ? "filled" : showClientMemoBox ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showClientMemoBox && (
                    <>
                      <textarea
                        value={closeClientMemo}
                        onChange={(e) => setCloseClientMemo(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
                        placeholder="Notes visible to the client..."
                        rows={2}
                        autoFocus
                        className="w-full mt-1.5 py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none resize-none placeholder:text-stone"
                      />
                      <p className="text-[10px] text-stone mt-1">
                        {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(closeClientMemo))} words remaining
                      </p>
                    </>
                  )}
                </div>
                <div>
                  <button
                    onClick={() => setShowInternalMemoBox(!showInternalMemoBox)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showInternalMemoBox || closeInternalMemo
                        ? "bg-walnut text-white border border-walnut"
                        : "border border-walnut/30 bg-amber-soft text-walnut hover:border-walnut"
                    }`}
                  >
                    <span>Internal Memo</span>
                    <span className="text-[10px] opacity-75">
                      {closeInternalMemo ? "filled" : showInternalMemoBox ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showInternalMemoBox && (
                    <textarea
                      value={closeInternalMemo}
                      onChange={(e) => setCloseInternalMemo(e.target.value)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none resize-none placeholder:text-stone"
                    />
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={resetWizard}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseOldAndStart}
                  disabled={!taskStatus || (!closeClientMemo.trim() && !closeInternalMemo.trim()) || submitting}
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
