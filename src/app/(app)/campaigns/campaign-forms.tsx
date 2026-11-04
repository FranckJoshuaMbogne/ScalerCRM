"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { estimateAudience, saveCampaign, submitTemplate } from "@/modules/campaigns/actions";
import type { Campaign } from "@/modules/campaigns/queries";
import { countVariables, renderBody } from "@/modules/campaigns/template";

type Option = { value: string; label: string };
type TemplateOption = Option & { body: string; variableCount: number; wabaId: string; mediaHeader: string | null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const box = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px]";

function Checks({ name, options, selected, label }: { name: string; options: Option[]; selected: string[]; label: string }) {
  if (!options.length) return null;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-medium">{label}</legend>
      <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-[13px]">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} /> {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CampaignForm({
  campaign,
  accounts,
  templates,
  branches,
  tags,
  sources,
  statuses,
  owners,
}: {
  campaign?: Campaign;
  accounts: (Option & { wabaId: string })[];
  templates: TemplateOption[];
  branches: Option[];
  tags: Option[];
  sources: Option[];
  statuses: Option[];
  owners: Option[];
}) {
  const [state, action] = useActionState(saveCampaign, initialState);
  const [accountId, setAccountId] = useState(campaign?.accountId ?? accounts[0]?.value ?? "");
  const waba = accounts.find((a) => a.value === accountId)?.wabaId;
  const usable = templates.filter((t) => t.wabaId === waba);
  const [templateId, setTemplateId] = useState(campaign?.templateId ?? "");
  const template = usable.find((t) => t.value === templateId);
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof estimateAudience>>>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const f = campaign?.filter ?? {};

  const refreshEstimate = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    start(async () => setEstimate(await estimateAudience(data)));
  };
  useEffect(refreshEstimate, []);

  const sample = template ? renderBody(template.body, Array.from({ length: template.variableCount }, (_, i) => {
    const v = campaign?.variables[i];
    return v?.source === "static" ? (v.value ?? "") : v?.source === "full_name" ? "Ravi Kumar" : v?.source === "business_name" ? "Your business" : "Ravi";
  })) : "";

  return (
    <form ref={form} action={action} onChange={(e) => (e.target as HTMLElement).closest("[data-filter]") && refreshEstimate()} className="flex flex-col gap-6">
      {campaign && <input type="hidden" name="campaignId" value={campaign.id} />}
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign name" name="name" defaultValue={campaign?.name} required maxLength={120} state={state} />
        <SelectField label="Send from" name="accountId" value={accountId} onChange={(e) => { setAccountId(e.target.value); setTemplateId(""); }} options={accounts} state={state} />
        <SelectField label="Approved template" name="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)}
          options={[{ value: "", label: usable.length ? "Choose a template" : "No approved templates for this number" }, ...usable]} state={state} />
        <Field label="Messages per minute" name="ratePerMinute" type="number" min={1} max={1000} defaultValue={campaign?.ratePerMinute ?? 60}
          hint="Keeps you inside WhatsApp's quality limits. Start low for a new number." state={state} />
        {template?.mediaHeader && (
          <Field label={`${template.mediaHeader.toLowerCase()} header link`} name="headerMediaUrl" type="url" defaultValue={campaign?.headerMediaUrl ?? ""}
            placeholder="https://…" className="sm:col-span-2" hint="A public https link to the file sent in the header." state={state} />
        )}
        {template && template.variableCount > 0 && (
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 text-[13px] font-medium">Fill the template&apos;s variables</legend>
            {Array.from({ length: template.variableCount }, (_, i) => {
              const v = campaign?.variables[i];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="w-12 font-mono">{`{{${i + 1}}}`}</span>
                  <select name={`var${i + 1}Source`} defaultValue={v?.source ?? "first_name"} className={box}>
                    <option value="first_name">Customer&apos;s first name</option>
                    <option value="full_name">Customer&apos;s full name</option>
                    <option value="business_name">Business name</option>
                    <option value="static">Fixed text…</option>
                  </select>
                  <input name={`var${i + 1}Value`} defaultValue={v?.value ?? ""} placeholder="Fixed text (if chosen)" maxLength={200} className={`${box} min-w-48 flex-1`} />
                </div>
              );
            })}
          </fieldset>
        )}
        {template && (
          <div className="rounded-[var(--radius-panel)] bg-signal-soft/50 p-3 text-[13.5px] whitespace-pre-line sm:col-span-2">
            <p className="mb-1 text-[12px] font-medium text-muted">Preview</p>
            {sample}
          </div>
        )}
      </section>

      <section data-filter className="flex flex-col gap-4 border-t border-line pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Audience</h2>
          <p className="text-[13px] tabular-nums" aria-live="polite">
            {pending ? "Counting…" : estimate ? (
              <>
                <strong className="text-[15px]">{estimate.eligible}</strong> will receive it ·{" "}
                <span className="text-muted">
                  {estimate.matching} match, {estimate.no_consent} without WhatsApp opt-in, {estimate.suppressed} suppressed, {estimate.no_phone} without a phone
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {branches.length > 1 && (
            <label className="flex flex-col gap-1 text-[13px] font-medium">Branch
              <select name="f_branch" defaultValue={f.branch_id ?? ""} className={box}>
                <option value="">Any branch</option>
                {branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-[13px] font-medium">Has ordered
            <select name="f_has_orders" defaultValue={f.has_orders === undefined ? "" : f.has_orders ? "yes" : "no"} className={box}>
              <option value="">Either</option><option value="yes">Yes, at least once</option><option value="no">Never</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">No order in the last (days)
            <input name="f_no_order_days" inputMode="numeric" defaultValue={f.no_order_days ?? ""} placeholder="e.g. 180" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Lifetime value at least
            <input name="f_min_ltv" inputMode="decimal" defaultValue={f.min_lifetime_value ?? ""} placeholder="e.g. 25000" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Added in the last (days)
            <input name="f_created_within_days" inputMode="numeric" defaultValue={f.created_within_days ?? ""} className={box} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Birthday month
            <select name="f_birthday_month" defaultValue={f.birthday_month ?? ""} className={box}>
              <option value="">Any</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          {owners.length > 0 && (
            <label className="flex flex-col gap-1 text-[13px] font-medium">Owner
              <select name="f_owner" defaultValue={f.owner_id ?? ""} className={box}>
                <option value="">Anyone</option>
                {owners.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <Checks name="f_tags" label="Tagged (any of)" options={tags} selected={f.tag_ids ?? []} />
        <Checks name="f_sources" label="Came from (any of)" options={sources} selected={f.lead_source_ids ?? []} />
        <Checks name="f_statuses" label="Has a lead in stage (any of)" options={statuses} selected={f.lead_status_ids ?? []} />
        <p className="text-[12.5px] text-muted">
          Only customers whose latest WhatsApp marketing consent is an opt-in, with a phone number that isn&apos;t suppressed, are ever sent to.
        </p>
      </section>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">{campaign ? "Save draft" : "Create draft"}</SubmitButton>
      </div>
    </form>
  );
}

export function TemplateForm({ accounts }: { accounts: Option[] }) {
  const [state, action] = useActionState(submitTemplate, initialState);
  const [body, setBody] = useState(state.values?.body ?? "");
  const [header, setHeader] = useState(state.values?.headerFormat ?? "");
  const vars = countVariables(body);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="WhatsApp number (its account owns the template)" name="accountId" options={accounts} state={state} />
        <Field label="Name" name="name" required pattern="[a-z0-9_]+" placeholder="diwali_offer" hint="Lowercase, numbers and underscores." state={state} />
        <SelectField label="Category" name="category" state={state}
          options={[{ value: "MARKETING", label: "Marketing (offers, announcements)" }, { value: "UTILITY", label: "Utility (order and appointment updates)" }]} />
        <Field label="Language code" name="language" defaultValue="en" placeholder="en, hi, te, en_US" state={state} />
        <SelectField label="Header" name="headerFormat" value={header} onChange={(e) => setHeader(e.target.value)} state={state}
          options={[{ value: "", label: "None" }, { value: "TEXT", label: "Text" }, { value: "IMAGE", label: "Image" }, { value: "VIDEO", label: "Video" }, { value: "DOCUMENT", label: "Document" }]} />
        {header === "TEXT" && <Field label="Header text" name="headerText" maxLength={60} state={state} />}
        {["IMAGE", "VIDEO", "DOCUMENT"].includes(header) && (
          <Field label="Sample file for review" name="headerSample" type="file" accept={header === "IMAGE" ? "image/jpeg,image/png" : header === "VIDEO" ? "video/mp4" : "application/pdf"} state={state} />
        )}
      </div>
      <TextAreaField label="Message" name="body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024}
        hint="Use {{1}}, {{2}}… for the parts that change per customer, e.g. Hi {{1}}, our Diwali collection is here." state={state} />
      {vars.ok && vars.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: vars.count }, (_, i) => (
            <Field key={i} label={`Example for {{${i + 1}}}`} name={`example${i + 1}`} required placeholder={i === 0 ? "Ravi" : ""} state={state} />
          ))}
        </div>
      )}
      {!vars.ok && <p className="text-[12.5px] text-danger">{vars.error}</p>}
      <Field label="Footer" name="footer" maxLength={60} placeholder="Reply STOP to opt out" state={state} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Buttons (optional)</legend>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select name={`button${i}Type`} defaultValue={i === 0 ? "QUICK_REPLY" : ""} aria-label={`Button ${i + 1} type`} className={box}>
              <option value="">No button</option>
              <option value="QUICK_REPLY">Quick reply</option>
              <option value="URL">Website</option>
              <option value="PHONE_NUMBER">Call</option>
            </select>
            <input name={`button${i}Text`} defaultValue={i === 0 ? "Stop promotions" : ""} placeholder="Label" maxLength={25} aria-label={`Button ${i + 1} label`} className={`${box} w-44`} />
            <input name={`button${i}Value`} placeholder="https://… or +91…" aria-label={`Button ${i + 1} link or number`} className={`${box} min-w-48 flex-1`} />
          </div>
        ))}
        <p className="text-[12.5px] text-muted">A &quot;Stop promotions&quot; quick reply lets customers opt out in one tap; SCALER records it automatically.</p>
      </fieldset>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Submitting to WhatsApp…">Submit for approval</SubmitButton>
      </div>
    </form>
  );
}
