/** The assignee's name, or an "Unassigned" badge for a task nobody has yet (e.g. from Perisclaw, person not a user). */
export function AssigneeName({ task }: { task: { assigned_to: string | null; assignee?: { full_name: string } | null } }) {
  if (!task.assigned_to) return <span className="badge unassigned" title="Nobody has this task yet. Use Reassign / Assign to give it to someone.">Unassigned</span>
  return <>{task.assignee?.full_name ?? '—'}</>
}
