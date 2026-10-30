// Close Active Task Before Clocking Out — ported from the web dashboard's
// clock-out dialog (src/app/(app)/dashboard/page.tsx, showClockOutModal), same
// fields, wording, and rules: a task status is required, at least one memo is
// required (client memo capped at 15 words), mood and day rating are optional,
// and a day rating needs a note of at least 5 words.
import { useState } from "react";
import { countWords } from "../lib/submissions";
import type { ClockOutWizardResult } from "../lib/clock";

// Same as CLIENT_MEMO_WORD_LIMIT on web.
const CLIENT_MEMO_WORD_LIMIT = 15;

function limitToWords(text: string, limit: number): string {
  const words = text.split(/(\s+)/);
  let count = 0;
  let out = "";
  for (const part of words) {
    if (part.trim()) {
      if (count >= limit) break;
      count++;
    }
    out += part;
  }
  return out;
}

interface ClockOutModalProps {
  taskName: string;
  initialClientMemo: string;
  initialInternalMemo: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (result: ClockOutWizardResult) => void;
}

export default function ClockOutModal({
  taskName,
  initialClientMemo,
  initialInternalMemo,
  submitting,
  onCancel,
  onSubmit,
}: ClockOutModalProps) {
  const [status, setStatus] = useState("");
  const [clientMemo, setClientMemo] = useState(initialClientMemo);
  const [internalMemo, setInternalMemo] = useState(initialInternalMemo);
  const [showClientMemo, setShowClientMemo] = useState(false);
  const [showInternalMemo, setShowInternalMemo] = useState(false);
  const [showMemoGuide, setShowMemoGuide] = useState(false);
  const [mood, setMood] = useState<"bad" | "neutral" | "good" | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNote, setRatingNote] = useState("");
  const [showRatingGuide, setShowRatingGuide] = useState(false);

  const noteWords = ratingNote.trim().split(/\s+/).filter(Boolean).length;
  const disabled =
    !status ||
    (!clientMemo.trim() && !internalMemo.trim()) ||
    submitting ||
    (rating !== null && noteWords < 5);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 overflow-y-auto py-4">
      <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4 my-auto">
        <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
          <h3 className="text-sm font-bold text-espresso">Close Active Task Before Clocking Out</h3>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>
        <div className="p-5">
          <div className="mb-4 p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
            You have an active task: <strong>{taskName}</strong>. Please close it before clocking out.
          </div>

          {/* Task Status */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
              Task Status <span className="text-terracotta">*</span>
            </p>
            <div className="flex gap-2">
              {["In Progress", "Completed", "On Hold"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                    status === s
                      ? s === "Completed"
                        ? "bg-sage text-white border border-sage"
                        : s === "On Hold"
                          ? "bg-amber text-white border border-amber"
                          : "bg-terracotta text-white border border-terracotta"
                      : "border border-sand bg-white text-bark hover:border-terracotta"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Memos — both independently fillable */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[11px] font-semibold text-walnut tracking-wide">
                Add Comments <span className="text-stone font-normal">(at least one required)</span>
              </p>
              <button
                type="button"
                onClick={() => setShowMemoGuide(!showMemoGuide)}
                className="text-[10px] w-4 h-4 rounded-full bg-slate-blue-soft text-slate-blue font-bold leading-none flex items-center justify-center cursor-pointer hover:bg-slate-blue hover:text-white transition-all flex-shrink-0"
                title="Memo writing guide"
              >
                ?
              </button>
            </div>
            {showMemoGuide && (
              <div className="mb-3 p-3 rounded-lg bg-parchment border border-sand text-[11px] text-walnut">
                <p className="font-semibold mb-1.5 text-espresso">Client Memo Guide</p>
                <p className="mb-2 italic text-[10px] text-walnut">Client Memo should answer: Who, What, Where, Why, Status.</p>
                <div className="space-y-1">
                  <p><span className="font-semibold">1. Who:</span> Who</p>
                  <p><span className="font-semibold">2. What:</span> Event, task title, or specific item (e.g., Checking May payment, Early bird flyer)</p>
                  <p><span className="font-semibold">3. Where:</span> Platform or destination (e.g., Social media post, Email Marketing, CRM)</p>
                  <p><span className="font-semibold">4. Why:</span> Purpose (e.g., Start Production, Continue Production, Revise flyer)</p>
                  <p><span className="font-semibold">5. Status:</span> Done, Pause</p>
                </div>
              </div>
            )}

            <div className="mb-3">
              <button
                onClick={() => setShowClientMemo(!showClientMemo)}
                className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  showClientMemo || clientMemo
                    ? "bg-slate-blue text-white border border-slate-blue"
                    : "border border-slate-blue/30 bg-slate-blue-soft text-slate-blue hover:border-slate-blue"
                }`}
              >
                <span>Client Memo</span>
                <span className="text-[10px] opacity-75">
                  {clientMemo ? "filled" : showClientMemo ? "collapse" : "expand"}
                </span>
              </button>
              {showClientMemo && (
                <>
                  <textarea
                    value={clientMemo}
                    onChange={(e) => setClientMemo(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
                    placeholder="Notes visible to the client..."
                    rows={2}
                    autoFocus
                    className="w-full mt-1.5 py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-slate-blue placeholder:text-stone resize-none"
                  />
                  <p className="text-[10px] text-stone mt-1">
                    {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(clientMemo))} words remaining
                  </p>
                </>
              )}
            </div>

            <div>
              <button
                onClick={() => setShowInternalMemo(!showInternalMemo)}
                className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  showInternalMemo || internalMemo
                    ? "bg-walnut text-white border border-walnut"
                    : "border border-walnut/30 bg-amber-soft text-walnut hover:border-walnut"
                }`}
              >
                <span>Internal Memo</span>
                <span className="text-[10px] opacity-75">
                  {internalMemo ? "filled" : showInternalMemo ? "collapse" : "expand"}
                </span>
              </button>
              {showInternalMemo && (
                <textarea
                  value={internalMemo}
                  onChange={(e) => setInternalMemo(e.target.value)}
                  placeholder="Internal notes (not visible to client)..."
                  rows={2}
                  autoFocus
                  className="w-full mt-1.5 py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-walnut placeholder:text-stone resize-none"
                />
              )}
            </div>
          </div>

          {/* Mood */}
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
              How was your day? <span className="text-stone font-normal">(optional)</span>
            </p>
            <div className="flex gap-2">
              {(
                [
                  { value: "bad" as const, emoji: "😞", label: "Not great" },
                  { value: "neutral" as const, emoji: "😐", label: "Okay" },
                  { value: "good" as const, emoji: "😊", label: "Great" },
                ]
              ).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMood(mood === m.value ? null : m.value)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                    mood === m.value
                      ? m.value === "good"
                        ? "bg-sage text-white border-2 border-sage"
                        : m.value === "bad"
                          ? "bg-terracotta text-white border-2 border-terracotta"
                          : "bg-amber text-white border-2 border-amber"
                      : "border border-sand bg-white text-bark hover:border-terracotta"
                  }`}
                >
                  <span className="text-xl">{m.emoji}</span>
                  <span className="text-[10px]">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Day Rating */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-[11px] font-semibold text-walnut tracking-wide">
                Day Rating <span className="text-stone font-normal">(optional)</span>
              </p>
              <button
                onClick={() => setShowRatingGuide(!showRatingGuide)}
                className="w-4 h-4 rounded-full border border-bark text-bark text-[9px] font-bold leading-none flex items-center justify-center hover:bg-parchment cursor-pointer shrink-0"
                title="What feedback are we looking for?"
              >
                ?
              </button>
            </div>
            {showRatingGuide && (
              <div className="mb-2 bg-parchment border border-sand rounded-lg p-3 text-[11px] text-bark">
                <p className="font-semibold text-espresso mb-1.5">How was your overall day?</p>
                <ul className="space-y-1">
                  <li>• What went well today</li>
                  <li>• What was challenging or frustrating</li>
                  <li>• What would have made today better</li>
                  <li>• Area: <span className="text-walnut font-medium">instruction, communication, technical,</span> or <span className="text-walnut font-medium">resources</span></li>
                </ul>
              </div>
            )}
            <div className="flex gap-1.5 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(rating === star ? null : star)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold cursor-pointer transition-all ${
                    rating !== null && star <= rating
                      ? "bg-amber text-white border border-amber"
                      : "border border-sand bg-white text-stone hover:border-amber"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
            {rating !== null && (
              <div>
                <textarea
                  value={ratingNote}
                  onChange={(e) => setRatingNote(e.target.value)}
                  placeholder="Explain your day rating (at least 5 words)..."
                  rows={2}
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-amber placeholder:text-stone resize-none"
                />
                {noteWords > 0 && noteWords < 5 && (
                  <p className="text-[10px] text-terracotta mt-1">Please write at least 5 words to explain your rating.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onSubmit({ clientMemo, internalMemo, mood, dayRating: rating, dayRatingNote: ratingNote })}
              disabled={disabled}
              className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Closing & clocking out..." : "Close Task & Clock Out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
