/**
 * Whether a task's card stays in the list while the Unread filter is on.
 *
 * Opening a card clears its unread count, which on its own would drop it out of
 * the filtered list in the same instant — before it could be read. A card
 * opened since the filter was switched on stays until the filter is toggled.
 */
export function showsInUnreadFilter(
  taskId: number | null | undefined,
  unreadByTask: Record<number, number>,
  openedSinceFilterOn: ReadonlySet<number>
): boolean {
  if (taskId == null) return false;
  return (unreadByTask[taskId] ?? 0) > 0 || openedSinceFilterOn.has(taskId);
}
