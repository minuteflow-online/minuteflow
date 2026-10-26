// Mirrors src/lib/billable.ts exactly — same rule, same reasoning (one place
// to decide paid vs not, after Break-as-billable drift cost two VAs ~4,300
// minutes each in back pay corrections). Duplicated rather than shared
// because this app can't import across into ../src — see cappedCloseTime.ts
// for the established precedent on that. Keep this in sync with the web file
// if the unpaid set ever changes.
const UNPAID_CATEGORIES = new Set(["Personal", "Break", "Pause"]);

export function isBillableCategory(category: string | null | undefined): boolean {
  return !UNPAID_CATEGORIES.has((category ?? "").trim());
}
