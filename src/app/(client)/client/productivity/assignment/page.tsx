"use client";

// The same Assignment screen staff use (table, filters, Active / Archived /
// Trash, Needs Revision, Submitted, columns). It recognises a client login
// and shows only their own team's work — see the client-mode notes in the
// staff page and the client branches in /api/assigned-tasks and
// /api/team-members.
import TaskListPage from "@/app/(app)/productivity/assignment/page";

export default function ClientAssignmentPage() {
  return <TaskListPage />;
}
