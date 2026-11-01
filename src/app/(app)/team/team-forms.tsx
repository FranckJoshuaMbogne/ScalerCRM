"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Field, FormMessage, SelectField, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { inviteMember, updateMember } from "@/modules/team/actions";

type Option = { id: string; name: string };

function BranchAccessFields({
  branches,
  defaultAll = true,
  defaultSelected = [],
  error,
  idPrefix,
}: {
  branches: Option[];
  defaultAll?: boolean;
  defaultSelected?: string[];
  error?: string;
  idPrefix: string;
}) {
  const [all, setAll] = useState(defaultAll);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-medium">Branch access</legend>
      <div className="flex flex-wrap gap-4 text-[13.5px]">
        <label className="flex items-center gap-2">
          <input type="radio" name="access" value="all" checked={all} onChange={() => setAll(true)} />
          All branches
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="access" value="selected" checked={!all} onChange={() => setAll(false)} />
          Only selected branches
        </label>
      </div>
      {!all && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-[var(--radius-control)] bg-paper px-3 py-2.5">
          {branches.map((b) => (
            <label key={b.id} htmlFor={`${idPrefix}-${b.id}`} className="flex items-center gap-2 text-[13.5px]">
              <input
                id={`${idPrefix}-${b.id}`}
                type="checkbox"
                name="branchIds"
                value={b.id}
                defaultChecked={defaultSelected.includes(b.id)}
              />
              {b.name}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </fieldset>
  );
}

export function InviteForm({ roles, branches }: { roles: Option[]; branches: Option[] }) {
  const [state, action] = useActionState(inviteMember, initialState);
  const [copied, setCopied] = useState(false);
  const defaultRole = roles.find((r) => r.name === "Sales executive")?.id ?? roles[0]?.id;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" name="email" type="email" required placeholder="name@business.com" state={state} />
        <SelectField
          label="Role"
          name="roleId"
          defaultValue={defaultRole}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          state={state}
        />
      </div>
      <BranchAccessFields branches={branches} error={state.fieldErrors?.branchIds} idPrefix="invite" />
      <FormMessage state={state} />
      {state.ok && state.data?.link && (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper p-2">
          <input
            readOnly
            value={state.data.link}
            aria-label="Invitation link"
            className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-muted outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.data!.link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface px-3 text-[13px] font-medium shadow-sm"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      <div>
        <SubmitButton pendingLabel="Creating invitation…">Create invitation</SubmitButton>
      </div>
    </form>
  );
}

export function EditMemberForm({
  membershipId,
  roleId,
  allBranches,
  branchIds,
  roles,
  branches,
}: {
  membershipId: string;
  roleId: string;
  allBranches: boolean;
  branchIds: string[];
  roles: Option[];
  branches: Option[];
}) {
  const [state, action] = useActionState(updateMember, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="membershipId" value={membershipId} />
      <SelectField
        label="Role"
        name="roleId"
        id={`role-${membershipId}`}
        defaultValue={roleId}
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
        className="max-w-xs"
      />
      <BranchAccessFields
        branches={branches}
        defaultAll={allBranches}
        defaultSelected={branchIds}
        idPrefix={membershipId}
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Save access
        </SubmitButton>
      </div>
    </form>
  );
}
