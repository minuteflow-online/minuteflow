import { createClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "./taskSchedule";
import { esc } from "./telegram";
import { notifyVaPrivately } from "./vaNotify";

/**
 * Tells someone privately that a task is now theirs.
 *
 * Private rather than team-wide: an assignment is one person's to pick up, and
 * posting every one of them to the group would bury the things the whole team
 * actually needs to see.
 *
 * Best-effort throughout — the task and the assignment are already saved before
 * this runs, and a Telegram problem must never fail the assignment itself.
 */
export async function notifyTaskAssigned(
  vaId: string,
  task: { id: number; task_name?: string; account?: string; project?: string; due_date?: string | null }
): Promise<void> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", vaId)
      .single();
    if (!prof) return;

    const who = (prof.full_name as string) || (prof.username as string) || "there";
    const where = [task.account, task.project].filter(Boolean).join(" / ");

    const lines = [
      "📌 <b>New task for you</b>",
      "",
      `Hi ${esc(who)} — ${esc(String(task.task_name ?? "a task"))} is yours.`,
    ];
    if (where) lines.push(`Project: ${esc(where)}`);
    if (task.due_date) {
      const due = new Date(String(task.due_date) + "T12:00:00Z").toLocaleDateString("en-US", {
        timeZone: ORG_TIMEZONE,
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      lines.push(`Due: ${esc(due)}`);
    }
    lines.push("", "It is on your dashboard whenever you are ready: https://minuteflow.click/dashboard");

    await notifyVaPrivately({
      chatId: prof.telegram_chat_id as number | null,
      userId: vaId,
      vaName: who,
      topic: "New task",
      message: lines.join("\n"),
    });
  } catch (err) {
    console.error("task-assigned notice failed:", err);
  }
}
