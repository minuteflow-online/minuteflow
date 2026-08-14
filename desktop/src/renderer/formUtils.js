/**
 * Small text-limiting helpers shared by closeTaskModal.js (client memo field)
 * and dashboard.js's to-do input. Split out from what used to be
 * taskForm.js's top-level constants — taskForm.js itself (the Log a Task
 * form: Account/Project/Task/Category cascade + validation) was removed
 * entirely per spec 1e ("Remove the Log a New Task form from the desktop app
 * entirely" — task creation now only happens in the web app). These three
 * were the only pieces of that file still needed elsewhere, so they moved
 * here rather than being deleted along with the rest.
 */

const MF_CLIENT_MEMO_WORD_LIMIT = 15;

// Ported from src/lib/utils.ts's countWords.
function mfCountWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Ported from TaskEntryForm.tsx's limitToWords.
function mfLimitToWords(text, limit) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}
