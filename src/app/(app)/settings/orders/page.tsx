import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { OrderStageBadge } from "@/components/crm/order-badges";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { listMeasurementTemplates } from "@/modules/measurements/queries";
import { listCatalog, listOrderStages } from "@/modules/orders/queries";
import {
  moveOrderStageConfig,
  setCatalogItemActive,
  setOrderStageActive,
  setTemplateActive,
} from "@/modules/orders/settings-actions";
import { can, getContext } from "@/modules/tenancy/session";
import { CatalogItemForm, OrderStageForm, TemplateForm } from "./order-settings-forms";

export const metadata = { title: "Order settings" };

type Action = Parameters<typeof ActionForm>[0]["action"];

function Toggle({ action, id, active }: { action: Action; id: string; active: boolean }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton variant="ghost">{active ? "Hide" : "Show"}</SubmitButton>
    </ActionForm>
  );
}

export default async function OrderSettingsPage() {
  const ctx = await getContext();
  if (!can(ctx, "settings.orders.manage")) return <NoAccess what="order settings" />;
  const id = ctx.business.businessId;
  const [catalog, stages, templates] = await Promise.all([listCatalog(id), listOrderStages(id), listMeasurementTemplates(id)]);
  const btn = "grid size-8 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper hover:text-text disabled:opacity-30";

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Settings</Link>
      <PageHeader title="Orders" description="What you sell, the stages an order goes through, and the measurements you take. Changes are audited." />

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
          Catalogue <span className="font-normal text-muted">({catalog.length})</span>
          <span className="block text-[13px] font-normal text-muted">Picked from when adding order lines. Prices can still be changed per order.</span>
        </h2>
        {catalog.length === 0 ? (
          <EmptyState title="Nothing in the catalogue yet">Order lines can also be typed by hand.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {catalog.map((c) => (
              <li key={c.id} className={`px-5 py-3 ${c.isActive ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
                  <span className="min-w-40 flex-1 font-medium">{c.name}</span>
                  <span className="text-muted">{c.category ?? (c.kind === "service" ? "Service" : "Product")}</span>
                  <span className="tabular-nums">{formatMoney(c.unitPrice, ctx.business.currency)}</span>
                  <span className="w-16 text-right text-muted tabular-nums">{Number(c.taxRate)}% tax</span>
                  <Toggle action={setCatalogItemActive} id={c.id} active={c.isActive} />
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Edit</summary>
                  <div className="mt-3 rounded-[var(--radius-control)] border border-line p-4"><CatalogItemForm item={c} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Add an item</h3>
          <CatalogItemForm />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
            Fulfilment stages
            <span className="block text-[13px] font-normal text-muted">New orders start in the first in-progress stage.</span>
          </h2>
          <ol className="divide-y divide-line">
            {stages.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 px-5 py-3">
                <div className="flex">
                  {(["up", "down"] as const).map((direction) => (
                    <ActionForm key={direction} action={moveOrderStageConfig}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="direction" value={direction} />
                      <button type="submit" className={btn} aria-label={direction === "up" ? "Move up" : "Move down"}
                        disabled={direction === "up" ? i === 0 : i === stages.length - 1}>
                        {direction === "up" ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                      </button>
                    </ActionForm>
                  ))}
                </div>
                <div className={`flex-1 ${s.isActive ? "" : "opacity-60"}`}>
                  <OrderStageBadge name={s.name} category={s.category} />
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12.5px] text-signal select-none">Rename</summary>
                    <div className="mt-2"><OrderStageForm stage={s} /></div>
                  </details>
                </div>
                <Toggle action={setOrderStageActive} id={s.id} active={s.isActive} />
              </li>
            ))}
          </ol>
          <div className="border-t border-line p-5"><OrderStageForm /></div>
        </Panel>

        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
            Measurement templates
            <span className="block text-[13px] font-normal text-muted">The fields asked for each garment on the customer file. Hide them all if you don&apos;t take measurements.</span>
          </h2>
          <ul className="divide-y divide-line">
            {templates.map((t) => (
              <li key={t.id} className={`px-5 py-3 ${t.isActive ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-2 text-[13.5px]">
                  <span className="flex-1 font-medium">{t.garment}</span>
                  <Toggle action={setTemplateActive} id={t.id} active={t.isActive} />
                </div>
                <p className="text-[12.5px] text-muted">{t.fields.map((f) => f.label).join(", ")}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12.5px] text-signal select-none">Edit</summary>
                  <div className="mt-2"><TemplateForm template={t} /></div>
                </details>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-5"><TemplateForm /></div>
        </Panel>
      </div>
    </>
  );
}
