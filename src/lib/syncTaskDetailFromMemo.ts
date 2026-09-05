// The reverse of assigned-tasks/[id]/route.ts's own "task_detail → client_memo"
// sync. A task's client detail is sometimes only knowable once someone is
// actually doing the work — a recurring "Blog Content Planning" template
// might turn out to be, specifically, this week's nutrition article — so the
// detail entered later, in the memo, is the more accurate one and should
// become the task's own task_detail. Not a duplicate under Toni's
// unique-detail rule: same task, refined once its specifics were known.
//
// Routed through the existing PATCH endpoint rather than writing
// assigned_tasks directly from the client, so it goes through the same
// permission checks, weekly-budget guards, and the edit-history log that
// every other task_detail change does — and, as a side effect, it re-syncs
// client_memo back onto every log linked to that task, which is harmless
// since it's the same value that triggered this in the first place.
export async function syncTaskDetailFromMemo(
  assignedTaskId: number | null | undefined,
  memo: string
): Promise<void> {
  if (assignedTaskId == null) return;
  const trimmed = memo.trim();
  if (!trimmed) return;
  try {
    await fetch(`/api/assigned-tasks/${assignedTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_detail: trimmed }),
    });
  } catch {
    // Best-effort — the memo itself already saved on the log either way.
  }
}
