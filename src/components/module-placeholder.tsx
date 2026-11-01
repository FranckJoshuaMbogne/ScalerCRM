import Link from "next/link";
import { findNav } from "@/components/shell/nav-config";
import { PageHeader, Panel } from "@/components/ui/primitives";

/** Honest empty state for modules that land in a later sprint. */
export function ModulePlaceholder({ href }: { href: string }) {
  const item = findNav(href);
  if (!item) throw new Error(`No nav entry for ${href}`);
  const Icon = item.icon;
  return (
    <>
      <PageHeader title={item.label} description={item.summary} />
      <Panel className="flex flex-col items-start gap-3 p-8">
        <span className="grid size-10 place-items-center rounded-full bg-signal-soft text-signal">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <p className="text-[15px] font-medium">Arrives in Sprint {item.sprint}</p>
        <p className="max-w-[60ch] text-[14px] text-muted">
          The screen layout and permissions for this module are planned in the
          sprint plan. Nothing is stored here yet.
        </p>
        <Link
          href="https://github.com/FranckJoshuaMbogne/ScalerCRM/blob/main/docs/SPRINTS.md"
          className="text-[13.5px] font-medium text-signal hover:underline"
        >
          View the sprint plan
        </Link>
      </Panel>
    </>
  );
}
