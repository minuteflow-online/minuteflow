// Account/project/category data for the Log an Activity tab — a simplified
// port of web's TaskEntryForm (see AGENTS.md's hourly path). Deliberately
// skips the fixed-pay billing path and its task-library autocomplete (Task
// is free text here); those stay web-only, same as Accept/Rework/fixed-pay
// Start already are on desktop.
import { query } from "./db";

export interface ProjectTag {
  id: number;
  account: string;
  project_name: string;
  sort_order: number;
}

// Same fallback list web's TaskEntryForm falls back to — used if the
// project_tags fetch fails or returns nothing, so the Account dropdown is
// never left empty.
export const FALLBACK_ACCOUNTS = [
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

// Mirrors web's FALLBACK_ACCOUNT_CLIENT_MAP — desktop has no equivalent of
// the account/accounts_client_map/clients join web's /api/task-form-options
// does (that route is cookie-session-only, unreachable from here anyway), so
// this fallback is the only mapping, not a fallback for a live one.
export const ACCOUNT_CLIENT_MAP: Record<string, string> = {
  "TAT Foundation": "Ting Chiu",
  "WSB Awesome Team": "Ting Chiu",
  TONIWSB: "Toni Colina",
  "Virtual Concierge": "Toni Colina",
  "Thess Personal": "Thess Peters",
  "Thess Base": "Thess Peters",
  "Colina Portrait": "Toni Colina",
  "Right Path Agency": "Gary Yip",
};

// "Task" is always disabled here, same as web's logActivityCategories rule
// (Toni's call — tasks are started from Assigned Tasks, not logged by hand).
export const CATEGORIES = [
  { label: "Task", value: "Task", disabled: true },
  { label: "Communication", value: "Communication", disabled: false },
  { label: "Planning", value: "Planning", disabled: false },
  { label: "Collaboration", value: "Collaboration", disabled: false },
  { label: "Break", value: "Break", disabled: false },
];

/** Active project tags, same table and RLS (public SELECT) the web dropdown reads. */
export async function fetchProjectTags(): Promise<ProjectTag[]> {
  try {
    const rows = await query<ProjectTag[]>("project_tags", {
      filters: "is_active=eq.true&select=id,account,project_name,sort_order&order=sort_order",
    });
    return rows ?? [];
  } catch {
    return [];
  }
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function limitToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}

export const CLIENT_MEMO_WORD_LIMIT = 15;
