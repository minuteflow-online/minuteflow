/**
 * Who may read, add or remove files on an Output Based (fixed_pay_tasks) task.
 *
 * Admins, managers and task_management holders always can. Beyond that, only the
 * VA who owns the task: the one who claimed it, or created it. Anyone else —
 * including another VA — is refused, so opening this up to the task's own VA
 * doesn't expose files on tasks they have nothing to do with.
 */
export function canManageFixedPayAttachments({
  isAdminLike,
  userId,
  claimedBy,
  createdBy,
}: {
  isAdminLike: boolean;
  userId: string;
  claimedBy: string | null | undefined;
  createdBy: string | null | undefined;
}): boolean {
  if (isAdminLike) return true;
  if (!userId) return false;
  return claimedBy === userId || createdBy === userId;
}
