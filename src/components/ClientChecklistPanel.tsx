"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClientPersonalTask } from "@/types/database";

// A client's own personal to-do list — "check on this VA", reminders, etc.
// Fully separate from assigned_tasks (what they hand to a VA) and from
// planned_tasks (a VA's own daily plan, which feeds performance metrics).
export default function ClientChecklistPanel() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ClientPersonalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("client_personal_tasks")
      .select("*")
      .order("completed", { ascending: true })
      .order("created_at", { ascending: true });
    setTasks((data ?? []) as ClientPersonalTask[]);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      await load(user.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTask = useCallback(async () => {
    const name = draft.trim();
    if (!name || !userId) return;
    setAdding(true);
    const { data } = await supabase
      .from("client_personal_tasks")
      .insert({ user_id: userId, task_name: name })
      .select()
      .single();
    if (data) setTasks((prev) => [...prev, data as ClientPersonalTask]);
    setDraft("");
    setAdding(false);
  }, [supabase, userId, draft]);

  const toggleTask = useCallback(
    async (task: ClientPersonalTask) => {
      const next = !task.completed;
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)));
      await supabase.from("client_personal_tasks").update({ completed: next }).eq("id", task.id);
    },
    [supabase]
  );

  const removeTask = useCallback(
    async (task: ClientPersonalTask) => {
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      await supabase.from("client_personal_tasks").delete().eq("id", task.id);
    },
    [supabase]
  );

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">My Tasks</h3>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addTask();
          }}
          placeholder="e.g. Check on Arianne's progress"
          className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
        />
        <button
          onClick={() => void addTask()}
          disabled={adding || !draft.trim()}
          className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 shrink-0"
        >
          Add
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading...
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-[12px] text-stone">Nothing on your list yet.</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg border border-sand bg-white"
            >
              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => void toggleTask(task)}
                className="h-3.5 w-3.5 shrink-0 accent-sage cursor-pointer"
              />
              <span
                className={`flex-1 text-[12px] ${
                  task.completed ? "text-stone line-through" : "text-espresso"
                }`}
              >
                {task.task_name}
              </span>
              <button
                onClick={() => void removeTask(task)}
                className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
