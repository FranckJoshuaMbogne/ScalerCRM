import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { X } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { formatBytes, formatDate, formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { formatCustomValue } from "@/modules/custom-fields/engine";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import {
  deleteAttachment,
  makePrimaryContact,
  removeAddress,
  removeContact,
  removeTag,
} from "@/modules/customers/actions";
import { getCustomer, listTags, signedAttachmentUrls } from "@/modules/customers/queries";
import { listStatuses } from "@/modules/leads/config";
import { listCustomerLeads } from "@/modules/leads/queries";
import { describeCustomerEvent } from "@/modules/leads/timeline";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import {
  AddAddressForm,
  AddContactForm,
  AddTagForm,
  ConsentForm,
  IdentityForm,
  NoteForm,
  UploadForm,
} from "../customer-forms";

export const metadata = { title: "Customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", call: "Phone call" };

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Panel>
  );
}

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "customers.view_all") && !can(ctx, "customers.view_assigned")) return <NoAccess what="customers" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const businessId = ctx.business.businessId;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  if (customer.mergedIntoId) redirect(`/customers/${customer.mergedIntoId}`);

  const [leads, statuses, branches, members, fields, allTags, urls] = await Promise.all([
    listCustomerLeads(id),
    listStatuses(businessId),
    listBranches(businessId),
    listMembers(businessId),
    listFieldDefinitions(businessId, "customer"),
    listTags(businessId),
    signedAttachmentUrls(customer.attachments.map((a) => a.storagePath)),
  ]);

  const status = new Map(statuses.map((s) => [s.id, s]));
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const edit = can(ctx, "customers.edit");
  const tz = ctx.business.timezone;
  const primaryPhone = customer.contacts.find((c) => c.kind === "phone" && c.isPrimary) ?? customer.contacts.find((c) => c.kind === "phone");

  return (
    <>
      <Link href="/customers" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Customers
      </Link>
      <PageHeader
        title={customer.fullName}
        description={`${customer.cifNumber} · customer since ${formatDate(customer.createdAt, tz)}${customer.branchId ? ` · ${branchName.get(customer.branchId) ?? ""}` : ""}`}
        actions={
          <>
            {can(ctx, "leads.create") && (
              <Link href={`/leads/new?customer=${customer.id}`} className={linkButton.secondary}>
                Add lead
              </Link>
            )}
            {can(ctx, "customers.merge") && (
              <Link href={`/customers/${customer.id}/merge`} className={linkButton.secondary}>
                Merge duplicate
              </Link>
            )}
          </>
        }
      />

      {(sp.created || sp.matched || sp.merged) && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          {sp.created && `Customer file ${customer.cifNumber} created.`}
          {sp.matched && `This ${sp.matched === "email" ? "email" : "phone number"} was already on file, so here is the existing customer.`}
          {sp.merged && "Files merged. Leads, contacts, notes and history from the duplicate are now here."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title={`Leads (${leads.length})`}>
            {leads.length === 0 ? (
              <EmptyState title="No leads yet" />
            ) : (
              <ul className="divide-y divide-line">
                {leads.map((l) => {
                  const s = status.get(l.statusId);
                  return (
                    <li key={l.id}>
                      <Link href={`/leads/${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px] hover:bg-paper/60">
                        <span className="font-medium">{l.leadNumber}</span>
                        <span className="min-w-0 flex-1 truncate text-muted">{l.title ?? "—"}</span>
                        <span className="tabular-nums">{formatMoney(l.expectedValue, ctx.business.currency)}</span>
                        {s && <StatusBadge stage={s.stage} name={s.name} />}
                        {l.archivedAt && <span className="text-[12px] text-muted">Archived</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Orders">
            <EmptyState title="Orders arrive in Sprint 4">Quotations, orders and payments will be listed here.</EmptyState>
          </Section>

          <Section title="Timeline">
            {edit && (
              <div className="border-b border-line px-5 py-4">
                <NoteForm customerId={customer.id} />
              </div>
            )}
            <ol className="divide-y divide-line">
              {customer.events.map((e) => (
                <li key={e.id} className="px-5 py-3 text-[13.5px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <p>
                      <span className="font-medium">{e.actorId ? (person.get(e.actorId) ?? "Former member") : "System"}</span>{" "}
                      {describeCustomerEvent(e)}
                    </p>
                    <time className="text-[12px] text-muted tabular-nums">{formatDateTime(e.createdAt, tz)}</time>
                  </div>
                  {e.type === "note" && e.body && <p className="mt-1 whitespace-pre-line text-muted">{e.body}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Contact">
            <ul className="divide-y divide-line">
              {customer.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {c.kind === "phone" ? formatPhone(c.value) : c.value}
                    {c.label && <span className="ml-1.5 text-[12px] text-muted">{c.label}</span>}
                    {c.isPrimary && <span className="ml-1.5 text-[12px] text-signal">Primary</span>}
                  </span>
                  {edit && !c.isPrimary && (
                    <ActionForm action={makePrimaryContact}>
                      <input type="hidden" name="contactId" value={c.id} />
                      <input type="hidden" name="customerId" value={customer.id} />
                      <input type="hidden" name="kind" value={c.kind} />
                      <SubmitButton variant="ghost">Make primary</SubmitButton>
                    </ActionForm>
                  )}
                  {edit && (
                    <ActionForm action={removeContact}>
                      <input type="hidden" name="contactId" value={c.id} />
                      <input type="hidden" name="customerId" value={customer.id} />
                      <SubmitButton variant="ghost" aria-label={`Remove ${c.value}`}>
                        <X className="size-3.5" />
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {primaryPhone && (
              <div className="flex gap-2 border-t border-line px-5 py-3">
                <a href={`tel:${primaryPhone.value}`} className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] hover:bg-paper">
                  Call
                </a>
                <a href={`https://wa.me/${primaryPhone.value.slice(1)}`} target="_blank" rel="noreferrer"
                  className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] hover:bg-paper">
                  WhatsApp
                </a>
              </div>
            )}
            {edit && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Add phone or email</summary>
                <div className="mt-3">
                  <AddContactForm customerId={customer.id} />
                </div>
              </details>
            )}
          </Section>

          <Section title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-5 py-4 text-[13.5px]">
              <dt className="text-muted">Gender</dt>
              <dd className="capitalize">{customer.gender ?? "—"}</dd>
              <dt className="text-muted">Date of birth</dt>
              <dd>{customer.dateOfBirth ? formatDate(`${customer.dateOfBirth}T00:00:00Z`, "UTC") : "—"}</dd>
              <dt className="text-muted">Language</dt>
              <dd>{customer.preferredLanguage ?? "—"}</dd>
              <dt className="text-muted">Owner</dt>
              <dd>{customer.ownerId ? (person.get(customer.ownerId) ?? "Former member") : "—"}</dd>
              {fields.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-muted">{f.label}</dt>
                  <dd>{formatCustomValue(f, customer.customFields[f.key])}</dd>
                </div>
              ))}
            </dl>
            {edit && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Edit details</summary>
                <div className="mt-3">
                  <IdentityForm
                    customer={customer}
                    branches={branches.filter((b) => b.isActive || b.id === customer.branchId).map((b) => ({ value: b.id, label: b.name }))}
                    fields={fields}
                  />
                </div>
              </details>
            )}
          </Section>

          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5 px-5 py-3">
              {customer.tags.length === 0 && <p className="text-[13px] text-muted">No tags</p>}
              {customer.tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-paper py-0.5 pr-1 pl-2.5 text-[12.5px]">
                  {t.name}
                  {edit && (
                    <ActionForm action={removeTag} className="inline-flex">
                      <input type="hidden" name="customerId" value={customer.id} />
                      <input type="hidden" name="tagId" value={t.id} />
                      <button type="submit" aria-label={`Remove tag ${t.name}`} className="rounded-full p-0.5 text-muted hover:bg-line hover:text-text">
                        <X className="size-3" />
                      </button>
                    </ActionForm>
                  )}
                </span>
              ))}
            </div>
            {edit && (
              <div className="border-t border-line px-5 py-3">
                <AddTagForm customerId={customer.id} suggestions={allTags.map((t) => t.name)} />
              </div>
            )}
          </Section>

          <Section title="Consent">
            <ul className="divide-y divide-line">
              {customer.consents.length === 0 && <li className="px-5 py-3 text-[13px] text-muted">Nothing recorded. Treat as not opted in.</li>}
              {customer.consents.map((c) => (
                <li key={`${c.channel}-${c.purpose}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13.5px]">
                  <span>
                    {CHANNELS[c.channel] ?? c.channel} <span className="text-muted">· {c.purpose}</span>
                  </span>
                  <span className={c.status === "opted_in" ? "text-stage-won" : "text-danger"}>
                    {c.status === "opted_in" ? "Opted in" : "Opted out"}
                    <span className="ml-1.5 text-[12px] text-muted">{formatDate(c.capturedAt, tz)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {edit && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Record consent</summary>
                <div className="mt-3">
                  <ConsentForm customerId={customer.id} />
                </div>
              </details>
            )}
          </Section>

          <Section title="Addresses">
            <ul className="divide-y divide-line">
              {customer.addresses.length === 0 && <li className="px-5 py-3 text-[13px] text-muted">No address yet</li>}
              {customer.addresses.map((a) => (
                <li key={a.id} className="flex items-start gap-2 px-5 py-2.5 text-[13.5px]">
                  <p className="flex-1">
                    {a.label && <span className="mr-1.5 text-[12px] font-medium text-muted">{a.label}</span>}
                    {[a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}
                  </p>
                  {edit && (
                    <ActionForm action={removeAddress}>
                      <input type="hidden" name="addressId" value={a.id} />
                      <SubmitButton variant="ghost" aria-label="Remove address">
                        <X className="size-3.5" />
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {edit && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Add address</summary>
                <div className="mt-3">
                  <AddAddressForm customerId={customer.id} />
                </div>
              </details>
            )}
          </Section>

          <Section title="Files">
            <ul className="divide-y divide-line">
              {customer.attachments.length === 0 && <li className="px-5 py-3 text-[13px] text-muted">No files</li>}
              {customer.attachments.map((a) => {
                const url = urls.get(a.storagePath);
                return (
                  <li key={a.id} className="flex items-center gap-2 px-5 py-2.5 text-[13.5px]">
                    <span className="min-w-0 flex-1 truncate">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="hover:text-signal">
                          {a.fileName}
                        </a>
                      ) : (
                        a.fileName
                      )}
                      <span className="ml-1.5 text-[12px] text-muted">{formatBytes(a.sizeBytes)}</span>
                    </span>
                    {edit && (
                      <ActionForm action={deleteAttachment}>
                        <input type="hidden" name="attachmentId" value={a.id} />
                        <SubmitButton variant="ghost" aria-label={`Delete ${a.fileName}`}>
                          <X className="size-3.5" />
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
            {edit && (
              <div className="border-t border-line px-5 py-3">
                <UploadForm customerId={customer.id} />
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
