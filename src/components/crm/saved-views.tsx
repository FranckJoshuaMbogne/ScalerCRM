import Link from "next/link";
import { X } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { deleteView, saveView } from "@/modules/analytics/actions";
import type { SavedView } from "@/modules/analytics/queries";

/** Saved filters for a list page: chips to reapply, and a small form to save the current ones. */
export function SavedViews({ page, path, views, query }: { page: string; path: string; views: SavedView[]; query: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface pr-1 pl-2.5">
          <Link href={`${path}?${v.query}`} className="py-1 hover:text-signal">{v.name}{v.shared && !v.mine ? " · team" : ""}</Link>
          {v.mine && (
            <ActionForm action={deleteView}>
              <input type="hidden" name="id" value={v.id} />
              <button type="submit" aria-label={`Delete view ${v.name}`} className="grid size-5 place-items-center rounded-full text-muted hover:bg-paper">
                <X className="size-3" />
              </button>
            </ActionForm>
          )}
        </span>
      ))}
      {query && (
        <details className="relative">
          <summary className="cursor-pointer rounded-full px-2.5 py-1 text-signal select-none hover:bg-surface">Save this view</summary>
          <div className="absolute z-10 mt-1 w-64 rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-lg">
            <ActionForm action={saveView} className="flex flex-col gap-2">
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="query" value={query} />
              <input name="name" required maxLength={60} placeholder="Name" aria-label="View name"
                className="h-8 rounded-[var(--radius-control)] border border-line px-2 text-[13px]" />
              <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" name="shared" /> Share with the team</label>
              <SubmitButton variant="secondary" className="h-8 text-[13px]">Save</SubmitButton>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
