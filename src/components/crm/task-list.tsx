import Link from "next/link";
import { cn } from "@/lib/utils";
import { describeDue } from "@/modules/tasks/schedule";
import type { Task } from "@/modules/tasks/queries";
import { TASK_TYPE_LABELS } from "@/modules/leads/timeline";
import { QuickContact } from "./quick-contact";
import { TaskActions } from "./task-actions";

type Option = { value: string; label: string };

/** Open tasks with due state, the customer to contact, and done/snooze controls. */
export function TaskList({
  tasks,
  now,
  timeZone,
  presets,
  people,
  assignees,
  showAssignee,
  showLead = true,
  canManage,
}: {
  tasks: Task[];
  now: Date;
  timeZone: string;
  presets: { key: string; label: string }[];
  people: Map<string, string>;
  assignees?: Option[];
  showAssignee?: boolean;
  showLead?: boolean;
  canManage: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const due = new Date(t.dueAt);
        const overdue = due.getTime() < now.getTime();
        return (
          <li key={t.id} className="flex flex-col gap-2 px-5 py-3.5 text-[13.5px]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0">
                <span className="mr-1.5 rounded bg-paper px-1.5 py-0.5 text-[11.5px] font-medium text-muted capitalize">
                  {TASK_TYPE_LABELS[t.type] ?? t.type}
                </span>
                <span className="font-medium">{t.title}</span>
                {showAssignee && t.assigneeId && (
                  <span className="text-muted"> · {people.get(t.assigneeId) ?? "Former member"}</span>
                )}
              </p>
              <span className={cn("text-[12.5px] tabular-nums", overdue ? "font-medium text-danger" : "text-muted")}>
                {describeDue(due, now, timeZone)}
              </span>
            </div>
            {showLead && (t.lead || t.customer) && (
              <p className="text-[12.5px] text-muted">
                {t.lead ? (
                  <Link href={`/leads/${t.lead.id}`} className="hover:text-signal">
                    {t.lead.leadNumber}
                    {t.customer ? ` · ${t.customer.fullName}` : ""}
                    {t.lead.title ? ` · ${t.lead.title}` : ""}
                  </Link>
                ) : t.customer ? (
                  <Link href={`/customers/${t.customer.id}`} className="hover:text-signal">
                    {t.customer.fullName}
                  </Link>
                ) : null}
              </p>
            )}
            {t.notes && <p className="whitespace-pre-line text-[12.5px] text-muted">{t.notes}</p>}
            <div className="flex flex-wrap items-start gap-2">
              <QuickContact phone={t.customer?.phone ?? null} compact />
              {canManage && (
                <TaskActions taskId={t.id} presets={presets} assignees={assignees} assigneeId={t.assigneeId} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
