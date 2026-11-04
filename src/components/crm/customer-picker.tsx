import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { formatPhone } from "@/lib/format";
import { findCustomers } from "@/modules/customers/queries";

/** Step one of "new order / book appointment" when no customer was chosen yet. */
export async function CustomerPicker({
  businessId,
  country,
  q,
  hrefFor,
}: {
  businessId: string;
  country: CountryCode;
  q: string;
  hrefFor: (customerId: string) => string;
}) {
  const results = q ? await findCustomers(businessId, q, country, "00000000-0000-0000-0000-000000000000") : [];
  return (
    <div className="flex flex-col gap-4">
      <form className="flex gap-2" role="search">
        <label htmlFor="pick-q" className="sr-only">Find a customer</label>
        <input
          id="pick-q"
          name="q"
          type="search"
          defaultValue={q}
          autoFocus
          placeholder="Phone, name or CIF number"
          className="h-10 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[14px] focus:border-signal focus:outline-none"
        />
        <button type="submit" className="h-10 rounded-[var(--radius-control)] bg-signal px-4 text-[14px] font-medium text-white hover:bg-signal-strong">
          Find
        </button>
      </form>
      {q && (
        results.length ? (
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {results.map((c) => (
              <li key={c.id}>
                <Link href={hrefFor(c.id)} className="flex flex-wrap items-center gap-x-4 px-4 py-3 text-[14px] hover:bg-paper">
                  <span className="font-medium">{c.fullName}</span>
                  <span className="text-[13px] text-muted">{c.cifNumber}</span>
                  <span className="text-[13px] text-muted tabular-nums">{formatPhone(c.phone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted">
            No customer found. <Link href="/customers/new" className="font-medium text-signal hover:underline">Create the customer file</Link> first.
          </p>
        )
      )}
    </div>
  );
}
