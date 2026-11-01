"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveRole } from "@/modules/team/actions";

type PermissionGroup = { module: string; label: string; items: { key: string; description: string }[] };

export function RoleEditor({
  groups,
  role,
}: {
  groups: PermissionGroup[];
  role?: { id: string; name: string; description: string | null; permissions: string[] };
}) {
  const [state, action] = useActionState(saveRole, initialState);
  const granted = new Set(role?.permissions ?? []);
  const prefix = role?.id ?? "new";

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="roleId" value={role?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name" name="name" id={`${prefix}-name`} defaultValue={role?.name} required state={state} />
        <Field
          label="Description"
          name="description"
          id={`${prefix}-desc`}
          defaultValue={role?.description ?? ""}
          placeholder="What this person does"
          state={state}
        />
      </div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <fieldset key={g.module}>
            <legend className="mb-2 text-[13px] font-semibold">{g.label}</legend>
            <div className="flex flex-col gap-1.5">
              {g.items.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={p.key}
                    defaultChecked={granted.has(p.key)}
                    className="mt-1"
                  />
                  {p.description}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">{role ? "Save role" : "Create role"}</SubmitButton>
      </div>
    </form>
  );
}
