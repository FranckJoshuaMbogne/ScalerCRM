import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatPhone } from "@/lib/format";
import { findCustomers, getCustomer } from "@/modules/customers/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { MergeForm } from "../../customer-forms";

export const metadata = { title: "Merge customers" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MergePage({ params, searchParams }: PageProps<"/customers/[id]/merge">) {
  const ctx = await getContext();
  if (!can(ctx, "customers.merge")) return <NoAccess what="merging customer files" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const q = one(sp.q);
  const pick = one(sp.duplicate);

  const keep = await getCustomer(id);
  if (!keep || keep.mergedIntoId) notFound();
  const [results, duplicate] = await Promise.all([
    q ? findCustomers(ctx.business.businessId, q, ctx.business.countryCode as CountryCode, id) : Promise.resolve([]),
    UUID.test(pick) && pick !== id ? getCustomer(pick) : Promise.resolve(null),
  ]);
  const tz = ctx.business.timezone;

  return (
    <>
      <Link href={`/customers/${id}`} className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        {keep.fullName}
      </Link>
      <PageHeader
        title="Merge a duplicate"
        description={`Find the duplicate file for ${keep.fullName} (${keep.cifNumber}). Its leads, contacts, notes, consent and files move here; the duplicate is kept as a pointer and a snapshot is saved.`}
      />

      <Panel className="mb-6 p-5">
        <form className="flex flex-wrap gap-2" role="search">
          <label className="min-w-[220px] flex-1">
            <span className="sr-only">Find duplicate</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Name, phone, email or CIF number"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px] focus:border-signal focus:outline-none"
            />
          </label>
          <button type="submit" className={linkButton.secondary}>
            Search
          </button>
        </form>
        {q && (
          <ul className="mt-4 divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {results.length === 0 && <EmptyState title="No other customer files match" />}
            {results.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/customers/${id}/merge?q=${encodeURIComponent(q)}&duplicate=${c.id}`}
                  aria-current={pick === c.id ? "true" : undefined}
                  className="flex flex-wrap items-center gap-x-4 px-4 py-2.5 text-[13.5px] hover:bg-paper aria-[current=true]:bg-signal-soft"
                >
                  <span className="font-medium">{c.fullName}</span>
                  <span className="text-muted">{c.cifNumber}</span>
                  <span className="tabular-nums">{formatPhone(c.phone)}</span>
                  <span className="text-muted">{c.email}</span>
                  <span className="ml-auto text-[12px] text-muted">since {formatDate(c.createdAt, tz)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {duplicate && !duplicate.mergedIntoId && (
        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Confirm</h2>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            {[
              { title: "Keep", c: keep },
              { title: "Fold in and retire", c: duplicate },
            ].map(({ title, c }) => (
              <div key={c.id} className="rounded-[var(--radius-control)] border border-line p-4 text-[13.5px]">
                <p className="text-[12px] font-medium text-muted">{title}</p>
                <p className="mt-1 font-semibold">
                  {c.fullName} <span className="font-normal text-muted">{c.cifNumber}</span>
                </p>
                <p className="mt-1 text-muted">{c.contacts.map((x) => (x.kind === "phone" ? formatPhone(x.value) : x.value)).join(" · ")}</p>
              </div>
            ))}
          </div>
          <MergeForm
            survivorId={keep.id}
            duplicateId={duplicate.id}
            label={`Merge ${duplicate.cifNumber} into ${keep.cifNumber}. This can't be undone from the app, but nothing is deleted.`}
          />
        </Panel>
      )}
    </>
  );
}
