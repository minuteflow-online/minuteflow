import { makeApprovalToken } from "./approvalToken";

/**
 * The Approve / Needs revision links that go on a submission's Telegram alert.
 *
 * Lives here rather than in the route that handles them so both sides import
 * one definition — a link built differently from the way it is verified fails
 * silently, and only for whoever taps it.
 *
 * The token is an HMAC over task, action and a server secret, the same scheme
 * the VA-request approval emails use. Anyone holding the link can act, which is
 * the point of tapping from a phone, but it cannot be guessed or edited into a
 * different task.
 */

export const REVIEW_ACTION_URL = "https://minuteflow.click/api/assigned-tasks/review-action";

export type ReviewAction = "approve" | "revision";

export function reviewLink(taskId: number, action: ReviewAction): string {
  return `${REVIEW_ACTION_URL}?id=${taskId}&do=${action}&t=${makeApprovalToken("submission", taskId, action)}`;
}

export function reviewLinks(taskId: number): { approve: string; revision: string } {
  return {
    approve: reviewLink(taskId, "approve"),
    revision: reviewLink(taskId, "revision"),
  };
}
