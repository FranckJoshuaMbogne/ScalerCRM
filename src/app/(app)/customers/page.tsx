import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { Plus } from "lucide-react";
import { Pager } from "@/components/crm/pager";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatPhone } from "@/lib/format";
import { CUSTOMERS_PAGE_SIZE, listCustomers, listTags } from "@/modules/customers/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Customers" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const control =
  "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px] focus:border-signal focus:outline-none";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await getContext();
  if (!can(ctx, "customers.view_all") && !can(ctx, "customers.view_assigned")) return <NoAccess what="customers" />;
  const sp = await searchParams;
  const q = one(sp.q) || undefined;
  const tag = one(sp.tag) || undefined;
  const page = Number(one(sp.page)) || 1;

  const [tags, { items, total }] = await Promise.all([
    listTags(ctx.business.businessId),
    listCustomers(ctx.business.businessId, ctx.business.countryCode as CountryCode, { q, tag, page }),
  ]);

  return (
    <>
      <PageHeader
        title="Customers"
        description="One file per person (CIF), matched by phone number, with every lead, note and consent attached."
        actions={
          can(ctx, "customers.create") ? (
            <Link href="/customers/new" className={linkButton.primary}>
              <Plus className="size-4" /> Add customer
            </Link>
          ) : undefined
        }
      />

      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Search customers</span>
          <input type="search" name="q" defaultValue={q} placeholder="Name, phone, email or CIF number" className={`${control} w-full px-3`} />
        </label>
        {tags.length > 0 && (
          <select name="tag" defaultValue={tag ?? ""} aria-label="Tag" className={control}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={linkButton.secondary}>
          Search
        </button>
        {(q || tag) && (
          <Link href="/customers" className="self-center px-2 text-[13px] text-muted hover:text-text">
            Clear
          </Link>
        )}
      </form>

      <Panel>
        {items.length === 0 ? (
          <EmptyState title={q || tag ? "No customers match" : "No customers yet"}>
            {!q && !tag && "Customer files are created automatically when you add a lead."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 hover:bg-paper/60">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[14px] font-medium">{c.fullName}</p>
                    <p className="text-[12.5px] text-muted">{c.cifNumber}</p>
                  </div>
                  <div className="w-44 text-[13px] tabular-nums">
                    <p>{formatPhone(c.phone)}</p>
                    {c.email && <p className="truncate text-muted">{c.email}</p>}
                  </div>
                  <div className="flex w-48 flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t.id} className="rounded-full bg-paper px-2 py-0.5 text-[12px] text-muted">
                        {t.name}
                      </span>
                    ))}
                  </div>
                  <p className="text-[12.5px] text-muted">Since {formatDate(c.createdAt, ctx.business.timezone)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Pager basePath="/customers" params={sp} page={page} pageSize={CUSTOMERS_PAGE_SIZE} total={total} />
    </>
  );
}
