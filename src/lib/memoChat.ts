/**
 * Memo questions get their own 1:1 chat per pair of people, kept apart from
 * their ordinary direct messages. It's an ordinary non-group conversation
 * marked by this reserved title. Conversation titles can't be renamed, so
 * the marker stays put. A plain 1:1 never carries a title, so the two kinds
 * can't be confused.
 */
export const MEMO_CHAT_TITLE = "Memo questions";

export function isMemoChat(conv: { is_group?: boolean | null; title?: string | null } | null | undefined): boolean {
  return !!conv && !conv.is_group && conv.title === MEMO_CHAT_TITLE;
}

/** Bell text for a message in a memo chat. NotificationBell matches this
 *  phrasing to route the click to the memo chat instead of the regular DM. */
export function memoChatNotice(senderName: string): string {
  return `${senderName} sent you a memo message`;
}

/** Dashboard link that opens the memo chat with this person. */
export function memoChatPath(userId: string): string {
  return `/dashboard?dmUserId=${encodeURIComponent(userId)}&memo=1`;
}
