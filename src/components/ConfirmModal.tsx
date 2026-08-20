"use client";

// Generic confirmation dialog — for actions that are hard to reverse
// (delete, primarily). Styled from the same overlay pattern GapFillModal
// and the other existing modals already use; not a new visual language.
// Controlled component: the caller decides when it's mounted, same
// convention as every other modal in this app (no portal/imperative API).

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (the default — this
   *  component exists mainly for deletes); false gives a neutral sage
   *  button for a non-destructive confirmation. */
  danger?: boolean;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  confirming = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-sand bg-white shadow-xl overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h2 className="font-serif text-lg font-bold text-espresso">{title}</h2>
          <p className="mt-2 text-sm text-stone">{message}</p>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="flex-1 rounded-lg bg-stone/10 px-4 py-2.5 text-[13px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={`flex-1 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-50 ${
              danger ? "bg-terracotta hover:bg-terracotta/90" : "bg-sage hover:bg-sage/90"
            }`}
          >
            {confirming ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
