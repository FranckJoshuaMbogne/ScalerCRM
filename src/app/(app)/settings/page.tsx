import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { setBranchActive } from "@/modules/settings/actions";
import { getBusinessProfile } from "@/modules/settings/queries";
import { listBranches } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { BranchForm, BusinessForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getContext();
  const id = ctx.business.businessId;
  const [profile, branches] = await Promise.all([getBusinessProfile(id), listBranches(id)]);
  const manageBusiness = can(ctx, "settings.business.manage");
  const manageBranches = can(ctx, "settings.branches.manage");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business details, branches, custom fields and API keys. Pipeline stage editing arrives in Sprint 3."
        actions={
          <>
            {can(ctx, "settings.custom_fields.manage") && (
              <Link href="/settings/custom-fields" className={linkButton.secondary}>
                Custom fields
              </Link>
            )}
            {can(ctx, "integrations.manage") && (
              <Link href="/settings/api-keys" className={linkButton.secondary}>
                API keys
              </Link>
            )}
            {can(ctx, "audit.view") && (
              <Link href="/settings/audit" className={linkButton.secondary}>
                Audit log
              </Link>
            )}
          </>
        }
      />

      <Panel className="mb-6 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Business</h2>
        <BusinessForm profile={profile} disabled={!manageBusiness} />
      </Panel>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
          Branches <span className="font-normal text-muted">({branches.length})</span>
        </h2>
        <ul className="divide-y divide-line">
          {branches.map((b) => (
            <li key={b.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <p className="min-w-[180px] flex-1 text-[14px] font-medium">
                  {b.name} {b.code && <span className="font-normal text-muted">{b.code}</span>}
                </p>
                <p className="flex-1 text-[13px] text-muted">
                  {[b.addressLine, b.city, b.state].filter(Boolean).join(", ") || "No address yet"}
                </p>
                {!b.isActive && (
                  <span className="rounded-full bg-line px-2 py-0.5 text-[12px] font-medium text-muted">Closed</span>
                )}
              </div>
              {manageBranches && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Edit branch</summary>
                  <div className="mt-3 flex flex-col gap-4 rounded-[var(--radius-control)] border border-line p-4">
                    <BranchForm branch={b} />
                    <ActionForm action={setBranchActive} className="border-t border-line pt-4">
                      <input type="hidden" name="branchId" value={b.id} />
                      <input type="hidden" name="active" value={String(!b.isActive)} />
                      <SubmitButton variant={b.isActive ? "danger" : "secondary"}>
                        {b.isActive ? "Close branch" : "Reopen branch"}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {manageBranches && (
        <Panel className="p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Add a branch</h2>
          <BranchForm />
        </Panel>
      )}
    </>
  );
}
