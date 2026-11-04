import "server-only";
import type { CatalogOption, EditorLine, MeasurementOption } from "@/components/crm/line-items-editor";
import { formatDate } from "@/lib/format";
import { listCustomerMeasurements, listMeasurementTemplates } from "@/modules/measurements/queries";
import { type LineItem, listCatalog } from "./queries";

/** Everything the line editor needs for one customer. */
export async function editorData(businessId: string, customerId: string, timeZone: string) {
  const [catalog, templates, measurements] = await Promise.all([
    listCatalog(businessId),
    listMeasurementTemplates(businessId),
    listCustomerMeasurements(customerId),
  ]);
  return {
    catalog: catalog
      .filter((c) => c.isActive)
      .map((c): CatalogOption => ({ id: c.id, name: c.name, unitPrice: c.unitPrice, taxRate: c.taxRate, category: c.category })),
    measurements: measurements.map(
      (m): MeasurementOption => ({ id: m.id, garment: m.garment, label: `${m.garment} · ${formatDate(m.takenAt, timeZone)}` }),
    ),
    // Garment, fabric and measurement columns appear for businesses that use measurement templates.
    tailoring: templates.some((t) => t.isActive),
  };
}

export function toEditorLines(items: LineItem[]): EditorLine[] {
  return items.map((i) => ({
    catalogItemId: i.catalogItemId ?? "",
    description: i.description,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount === "0" || i.discount === "0.00" ? "" : i.discount,
    taxRate: i.taxRate === "0" || i.taxRate === "0.00" ? "" : i.taxRate,
    garment: i.garment ?? "",
    fabric: i.fabric ?? "",
    measurementId: i.measurementId ?? "",
  }));
}
