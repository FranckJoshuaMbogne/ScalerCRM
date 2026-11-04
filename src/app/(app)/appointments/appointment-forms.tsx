"use client";

import { useActionState } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { bookAppointment, registerWalkIn, rescheduleAppointment, setAppointmentStatus } from "@/modules/appointments/actions";

type Option = { value: string; label: string };

export const KIND_OPTIONS: Option[] = [
  { value: "consultation", label: "Consultation" },
  { value: "measurement", label: "Measurement" },
  { value: "trial", label: "Trial" },
  { value: "alteration", label: "Alteration" },
  { value: "delivery", label: "Delivery / pickup" },
  { value: "other", label: "Other" },
];

const DURATIONS: Option[] = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
];

export function BookForm({
  customerId,
  leadId,
  orderId,
  kind,
  branches,
  staff,
  defaultStaff,
  minDate,
}: {
  customerId: string;
  leadId: string | null;
  orderId: string | null;
  kind: string;
  branches: Option[];
  staff: Option[];
  defaultStaff: string;
  minDate: string;
}) {
  const [state, action] = useActionState(bookAppointment, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="customerId" value={customerId} />
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" name="kind" defaultValue={kind} options={KIND_OPTIONS} state={state} />
        <Field label="When" name="startsAt" type="datetime-local" min={minDate} required state={state} />
        <SelectField label="Length" name="duration" defaultValue="30" options={DURATIONS} state={state} />
        {staff.length > 1 && <SelectField label="With" name="staffId" defaultValue={defaultStaff} options={staff} state={state} />}
        {branches.length > 1 && (
          <SelectField label="Branch" name="branchId" options={[{ value: "", label: "No particular branch" }, ...branches]} state={state} />
        )}
        <Field label="Title" name="title" placeholder="Optional, e.g. First trial of sherwani" maxLength={160} state={state} />
        <TextAreaField label="Notes" name="notes" rows={2} className="sm:col-span-2" state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Booking…">Book appointment</SubmitButton>
      </div>
    </form>
  );
}

/** Quick outcome buttons on a calendar entry. */
export function OutcomeButtons({ appointmentId, status }: { appointmentId: string; status: string }) {
  const [state, action] = useActionState(setAppointmentStatus, initialState);
  const [moveState, move] = useActionState(rescheduleAppointment, initialState);
  const open = status === "scheduled" || status === "confirmed";
  const message = [state, moveState].find((s) => s.message && !s.ok);
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap gap-1.5">
        <input type="hidden" name="appointmentId" value={appointmentId} />
        {status === "scheduled" && (
          <SubmitButton name="status" value="confirmed" variant="ghost">Confirmed</SubmitButton>
        )}
        {open && (
          <>
            <SubmitButton name="status" value="completed" variant="secondary" className="h-8 px-3 text-[13px]">Arrived</SubmitButton>
            <SubmitButton name="status" value="no_show" variant="ghost">No-show</SubmitButton>
            <SubmitButton name="status" value="cancelled" variant="ghost">Cancel</SubmitButton>
          </>
        )}
        {!open && <SubmitButton name="status" value="scheduled" variant="ghost">Undo</SubmitButton>}
      </form>
      {open && (
        <details>
          <summary className="cursor-pointer text-[12.5px] text-muted select-none">Reschedule</summary>
          <form action={move} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="appointmentId" value={appointmentId} />
            <label className="text-[12px]">
              <span className="sr-only">New time</span>
              <input type="datetime-local" name="startsAt" required className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]" />
            </label>
            <select name="duration" defaultValue="30" aria-label="Length" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]">
              {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <SubmitButton variant="secondary" className="h-8 px-3 text-[13px]">Move</SubmitButton>
          </form>
        </details>
      )}
      {message && <FormMessage state={message} />}
    </div>
  );
}

export function WalkInForm({ branches, staff, defaultStaff, defaultBranch }: { branches: Option[]; staff: Option[]; defaultStaff: string; defaultBranch: string }) {
  const [state, action] = useActionState(registerWalkIn, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="off" autoFocus placeholder="98490 12345"
          hint="Looked up first. A returning customer keeps their file and open lead." state={state} />
        <Field label="Name" name="fullName" autoComplete="off" hint="Used only for a new customer." state={state} />
        <Field label="Looking for" name="purpose" placeholder="Wedding suit, alteration…" maxLength={160} state={state} />
        {branches.length > 1 && (
          <SelectField label="Branch" name="branchId" defaultValue={defaultBranch} options={[{ value: "", label: "No particular branch" }, ...branches]} state={state} />
        )}
        {staff.length > 1 && <SelectField label="Attended by" name="staffId" defaultValue={defaultStaff} options={staff} state={state} />}
        <TextAreaField label="Notes" name="notes" rows={2} className="sm:col-span-2" state={state} />
        <label className="flex items-start gap-2 text-[13.5px] sm:col-span-2">
          <input type="checkbox" name="whatsappOptIn" className="mt-1" />
          <span>Customer agreed to receive offers on WhatsApp <span className="text-muted">(recorded as consent; they can reply STOP any time)</span></span>
        </label>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Registering…">Register walk-in</SubmitButton>
      </div>
    </form>
  );
}
