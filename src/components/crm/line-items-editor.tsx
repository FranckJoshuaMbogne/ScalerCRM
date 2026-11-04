"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { documentTotals, fromPaise, lineAmounts } from "@/modules/orders/money";

export type EditorLine = {
  catalogItemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  garment: string;
  fabric: string;
  measurementId: string;
};

export type CatalogOption = { id: string; name: string; unitPrice: string; taxRate: string; category: string | null };
export type MeasurementOption = { id: string; label: string; garment: string };

const blank = (): EditorLine => ({
  catalogItemId: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  discount: "",
  taxRate: "",
  garment: "",
  fabric: "",
  measurementId: "",
});

const input =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px] focus:border-signal focus:outline-none";

/**
 * Line items for quotations and orders. Totals are previewed with the same
 * exact maths the database uses; the rows are posted as JSON in `items`.
 */
export function LineItemsEditor({
  initial,
  catalog,
  measurements,
  currency,
  tailoring,
}: {
  initial?: EditorLine[];
  catalog: CatalogOption[];
  measurements: MeasurementOption[];
  currency: string;
  tailoring: boolean;
}) {
  const [lines, setLines] = useState<EditorLine[]>(initial?.length ? initial : [blank()]);
  const totals = useMemo(() => documentTotals(lines), [lines]);

  const update = (i: number, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function pick(i: number, id: string) {
    const item = catalog.find((c) => c.id === id);
    update(i, item
      ? { catalogItemId: id, description: item.name, unitPrice: item.unitPrice, taxRate: item.taxRate }
      : { catalogItemId: "" });
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="items" value={JSON.stringify(lines)} />
      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => {
          const a = lineAmounts(l);
          return (
            <li key={i} className="rounded-[var(--radius-control)] border border-line p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-5 text-[12px] text-muted tabular-nums">{i + 1}</span>
                <div className="grid flex-1 gap-2 sm:grid-cols-6">
                  {catalog.length > 0 && (
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-[12px] text-muted">From catalogue</span>
                      <select value={l.catalogItemId} onChange={(e) => pick(i, e.target.value)} className={input}>
                        <option value="">Custom line</option>
                        {catalog.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.category ? `${c.category} · ` : ""}
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className={catalog.length > 0 ? "sm:col-span-4" : "sm:col-span-6"}>
                    <span className="mb-1 block text-[12px] text-muted">Description</span>
                    <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} maxLength={300} required className={input} />
                  </label>
                  <label>
                    <span className="mb-1 block text-[12px] text-muted">Qty</span>
                    <input value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} inputMode="decimal" className={input} />
                  </label>
                  <label>
                    <span className="mb-1 block text-[12px] text-muted">Price</span>
                    <input value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" className={input} />
                  </label>
                  <label>
                    <span className="mb-1 block text-[12px] text-muted">Discount</span>
                    <input value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} inputMode="decimal" placeholder="0" className={input} />
                  </label>
                  <label>
                    <span className="mb-1 block text-[12px] text-muted">Tax %</span>
                    <input value={l.taxRate} onChange={(e) => update(i, { taxRate: e.target.value })} inputMode="decimal" placeholder="0" className={input} />
                  </label>
                  <div className="flex flex-col justify-end sm:col-span-2">
                    <span className="mb-1 block text-[12px] text-muted">Line total</span>
                    <p className="flex h-9 items-center justify-end text-[14px] font-medium tabular-nums">
                      {a ? formatMoney(fromPaise(a.total), currency) : <span className="text-danger">Check numbers</span>}
                    </p>
                  </div>
                  {tailoring && (
                    <>
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-[12px] text-muted">Garment</span>
                        <input value={l.garment} onChange={(e) => update(i, { garment: e.target.value })} maxLength={60} placeholder="Sherwani" className={input} />
                      </label>
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-[12px] text-muted">Fabric</span>
                        <input value={l.fabric} onChange={(e) => update(i, { fabric: e.target.value })} maxLength={120} placeholder="Raw silk, ivory" className={input} />
                      </label>
                      {measurements.length > 0 && (
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-[12px] text-muted">Measurements</span>
                          <select value={l.measurementId} onChange={(e) => update(i, { measurementId: e.target.value })} className={input}>
                            <option value="">None</option>
                            {measurements.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))}
                  aria-label={`Remove line ${i + 1}`}
                  className="mt-6 grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper hover:text-danger"
                >
                  <X className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, blank()])}
          disabled={lines.length >= 100}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line px-3 text-[13px] font-medium text-muted hover:text-text"
        >
          <Plus className="size-4" /> Add line
        </button>
      </div>
      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-[13.5px] tabular-nums">
        <dt className="text-muted">Subtotal</dt>
        <dd className="text-right">{formatMoney(totals.subtotal, currency)}</dd>
        <dt className="text-muted">Discounts</dt>
        <dd className="text-right">−{formatMoney(totals.discount, currency)}</dd>
        <dt className="text-muted">Tax</dt>
        <dd className="text-right">{formatMoney(totals.tax, currency)}</dd>
        <dt className="border-t border-line pt-1 font-semibold">Total</dt>
        <dd className="border-t border-line pt-1 text-right font-semibold">{formatMoney(totals.total, currency)}</dd>
      </dl>
    </div>
  );
}
