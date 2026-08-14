/**
 * Shared "close the active task" confirm dialog — used for both:
 *   - switching tasks while one is already active (mirrors TaskEntryForm.tsx's
 *     "Close Current Task" wizard modal, lines 676-872: status + at least one
 *     memo, no mood/day-rating)
 *   - Clock Out with an active task (mirrors dashboard/page.tsx's Clock Out
 *     modal / handleCloseTaskAndClockOut, lines 3631-3870: same status+memo
 *     requirement, PLUS optional mood + day rating)
 *
 * This is a deliberate UI consolidation (documented in the desktop README):
 * the web app implements these as two separate, near-identical modals: this
 * shares ONE dialog for both, toggling the mood/day-rating section by mode.
 * The validation rules for each mode are identical to their web app source.
 */

const mfCloseTaskModalState = {
  mode: null, // 'switch' | 'clockout'
  status: "",
  clientMemo: "",
  internalMemo: "",
  mood: null,
  dayRating: null,
  dayRatingNote: "",
  onConfirm: null, // async ({status, clientMemo, internalMemo, mood, dayRating, dayRatingNote}) => void
};

function mfCloseTaskModalIsValid() {
  const s = mfCloseTaskModalState;
  if (!s.status) return false;
  if (!s.clientMemo.trim() && !s.internalMemo.trim()) return false;
  if (s.mode === "clockout" && s.dayRating != null && mfCountWords(s.dayRatingNote) < 5) return false;
  return true;
}

function mfOpenCloseTaskModal(mode, activeTaskName, onConfirm) {
  Object.assign(mfCloseTaskModalState, {
    mode,
    status: "",
    clientMemo: "",
    internalMemo: "",
    mood: null,
    dayRating: null,
    dayRatingNote: "",
    onConfirm,
  });

  document.getElementById("close-task-modal-title").textContent =
    mode === "clockout" ? "Close Active Task Before Clocking Out" : "Close Current Task";
  document.getElementById("close-task-modal-active-name").textContent = activeTaskName
    ? `You have an active task: ${activeTaskName}.`
    : "";
  document.getElementById("close-task-mood-section").hidden = mode !== "clockout";
  document.getElementById("close-task-rating-section").hidden = mode !== "clockout";
  document.getElementById("close-task-confirm-btn").textContent =
    mode === "clockout" ? "Close Task & Clock Out" : "Close & Start New Task";

  // Reset field values from the last time this modal was used.
  document.getElementById("close-task-client-memo").value = "";
  document.getElementById("close-task-internal-memo").value = "";
  document.getElementById("close-task-rating-note").value = "";

  mfRenderCloseTaskModal();
  document.getElementById("close-task-modal").hidden = false;
}

function mfCancelCloseTaskModal() {
  document.getElementById("close-task-modal").hidden = true;
  mfCloseTaskModalState.onConfirm = null;
}

function mfRenderCloseTaskModal() {
  const s = mfCloseTaskModalState;

  document.querySelectorAll("#close-task-status-group button").forEach((btn) => {
    btn.classList.toggle("status-btn-active", btn.dataset.status === s.status);
  });
  document.querySelectorAll("#close-task-mood-section button[data-mood]").forEach((btn) => {
    btn.classList.toggle("mood-btn-active", btn.dataset.mood === s.mood);
  });
  document.querySelectorAll("#close-task-rating-section button[data-star]").forEach((btn) => {
    const star = Number(btn.dataset.star);
    btn.classList.toggle("star-btn-active", s.dayRating != null && star <= s.dayRating);
  });
  document.getElementById("close-task-rating-note-wrap").hidden = s.dayRating == null;

  document.getElementById("close-task-confirm-btn").disabled = !mfCloseTaskModalIsValid();
}

// onConfirm returns { ok, error? } — this keeps failure handling in one place
// instead of throwing across the two modules.
async function mfConfirmCloseTaskModal() {
  const s = mfCloseTaskModalState;
  if (!mfCloseTaskModalIsValid() || !s.onConfirm) return;

  const btn = document.getElementById("close-task-confirm-btn");
  const errorEl = document.getElementById("close-task-modal-error");
  errorEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Working…";

  const result = await s.onConfirm({
    status: s.status,
    clientMemo: s.clientMemo,
    internalMemo: s.internalMemo,
    mood: s.mood,
    dayRating: s.dayRating,
    dayRatingNote: s.dayRatingNote,
  });

  if (result?.ok) {
    document.getElementById("close-task-modal").hidden = true;
  } else {
    errorEl.textContent = result?.error || "Something went wrong.";
    errorEl.hidden = false;
  }

  btn.disabled = !mfCloseTaskModalIsValid();
  btn.textContent = s.mode === "clockout" ? "Close Task & Clock Out" : "Close & Start New Task";
}

function mfInitCloseTaskModal() {
  document.querySelectorAll("#close-task-status-group button").forEach((btn) => {
    btn.addEventListener("click", () => {
      mfCloseTaskModalState.status = btn.dataset.status;
      mfRenderCloseTaskModal();
    });
  });

  document.getElementById("close-task-client-memo").addEventListener("input", (e) => {
    mfCloseTaskModalState.clientMemo = mfLimitToWords(e.target.value, MF_CLIENT_MEMO_WORD_LIMIT);
    e.target.value = mfCloseTaskModalState.clientMemo;
    mfRenderCloseTaskModal();
  });
  document.getElementById("close-task-internal-memo").addEventListener("input", (e) => {
    mfCloseTaskModalState.internalMemo = e.target.value;
    mfRenderCloseTaskModal();
  });

  document.querySelectorAll("#close-task-mood-section button[data-mood]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mfCloseTaskModalState.mood = mfCloseTaskModalState.mood === btn.dataset.mood ? null : btn.dataset.mood;
      mfRenderCloseTaskModal();
    });
  });

  document.querySelectorAll("#close-task-rating-section button[data-star]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const star = Number(btn.dataset.star);
      mfCloseTaskModalState.dayRating = mfCloseTaskModalState.dayRating === star ? null : star;
      mfRenderCloseTaskModal();
    });
  });
  document.getElementById("close-task-rating-note").addEventListener("input", (e) => {
    mfCloseTaskModalState.dayRatingNote = e.target.value;
    mfRenderCloseTaskModal();
  });

  document.getElementById("close-task-cancel-btn").addEventListener("click", mfCancelCloseTaskModal);
  document.getElementById("close-task-cancel-x").addEventListener("click", mfCancelCloseTaskModal);
  document.getElementById("close-task-confirm-btn").addEventListener("click", mfConfirmCloseTaskModal);
}
