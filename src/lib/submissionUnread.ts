/**
 * Entries that carry an unread marker. Approvals and reversals are decisions,
 * not something to open and read, and an auto-approval is written under the
 * submitter's own name, so counting them would double every submission.
 */
const UNREAD_TYPES = new Set(["submission", "revision", "comment"]);

/**
 * Nothing older than this counts as unread. submission_reads starts empty, so
 * without a cutoff every existing submission would light up the first time
 * anyone opened the page.
 */
export const UNREAD_SINCE = "2026-09-19T00:00:00Z";

export function isUnreadCandidate(
  entry: { user_id: string | null; message_type: string; created_at: string },
  viewerId: string
): boolean {
  return (
    entry.user_id !== viewerId &&
    UNREAD_TYPES.has(entry.message_type) &&
    entry.created_at >= UNREAD_SINCE
  );
}
