import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { InstallAppButton } from "@/components/shell/pwa";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { chooseTemplate, createDemo, finishSetup, markStep } from "@/modules/onboarding/actions";
import { findDemoBusiness, getOnboarding, listIndustryTemplates } from "@/modules/onboarding/queries";
import { isStep, nextStep, progress, STEPS, type StepKey } from "@/modules/onboarding/steps";
import { getBusinessProfile } from "@/modules/settings/queries";
import { listBranches } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { BranchForm, BusinessForm } from "../settings/settings-forms";

export const metadata = { title: "Set up SCALER" };
export const maxDuration = 30;

function StepButtons({ step, continueLabel = "Continue" }: { step: StepKey; continueLabel?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <ActionForm action={markStep}>
        <input type="hidden" name="step" value={step} />
        <input type="hidden" name="value" value="done" />
        <SubmitButton pendingLabel="Saving…">{continueLabel}</SubmitButton>
      </ActionForm>
      <ActionForm action={markStep}>
        <input type="hidden" name="step" value={step} />
        <input type="hidden" name="value" value="skipped" />
        <SubmitButton variant="ghost" pendingLabel="…">
          Skip for now
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

async function StepBody({ step, businessId }: { step: StepKey; businessId: string }) {
  switch (step) {
    case "profile": {
      const profile = await getBusinessProfile(businessId);
      return (
        <>
          <BusinessForm profile={profile} disabled={false} />
          <StepButtons step="profile" />
        </>
      );
    }
    case "template": {
      const templates = await listIndustryTemplates();
      return (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <li key={t.key} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-4">
                <p className="text-[15px] font-semibold">{t.name}</p>
                {t.description && <p className="text-[13px] text-muted">{t.description}</p>}
                <p className="text-[12.5px] text-muted">Stages: {t.stages.join(" → ")}</p>
                <p className="text-[12.5px] text-muted">Orders: {t.orderStages.join(" → ")}</p>
                {t.fields.length > 0 && <p className="text-[12.5px] text-muted">Fields: {t.fields.join(", ")}</p>}
                <ActionForm action={chooseTemplate} className="mt-auto pt-2">
                  <input type="hidden" name="template" value={t.key} />
                  <SubmitButton variant="secondary" pendingLabel="Setting up…">
                    Use this
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-muted">Everything can be changed later in Settings. Templates apply before your first lead.</p>
          <StepButtons step="template" continueLabel="Keep the current setup" />
        </>
      );
    }
    case "branches": {
      const branches = await listBranches(businessId);
      return (
        <>
          <ul className="mb-4 space-y-1 text-[14px]">
            {branches.map((b) => (
              <li key={b.id}>
                <Check className="mr-1.5 inline size-4 text-stage-won" />
                {b.name}
              </li>
            ))}
          </ul>
          <BranchForm />
          <StepButtons step="branches" continueLabel="That's all our branches" />
        </>
      );
    }
    case "team":
      return (
        <>
          <p className="text-[14px]">
            Invite people by email or share a one-time link on WhatsApp. Sales executives see their own leads; managers see everyone&apos;s.
          </p>
          <Link href="/team" className={cn(linkButton.primary, "mt-4")}>
            Invite people
          </Link>
          <StepButtons step="team" />
        </>
      );
    case "whatsapp":
      return (
        <>
          <p className="text-[14px]">
            Connect your WhatsApp Business number with Meta in a few clicks. Replies to customers work at once. During the free trial,
            SCALER checks new numbers before campaigns and reminders can be sent; this usually takes a few hours. Paying skips the check.
          </p>
          <Link href="/integrations" className={cn(linkButton.primary, "mt-4")}>
            Connect WhatsApp
          </Link>
          <StepButtons step="whatsapp" />
        </>
      );
    case "import": {
      const demo = await findDemoBusiness();
      return (
        <>
          <p className="text-[14px]">Upload a CSV of customers, leads or orders. Phone numbers are matched, so nobody is added twice.</p>
          <Link href="/settings/import" className={cn(linkButton.primary, "mt-4")}>
            Import a spreadsheet
          </Link>
          <div className="mt-6 rounded-[var(--radius-control)] border border-dashed border-line p-4">
            <p className="text-[14px] font-medium">Not ready? Try it with sample data</p>
            <p className="mb-3 text-[13px] text-muted">
              Opens a separate demo business with sample leads, so your real business stays clean. Remove it in one click when you&apos;re done.
            </p>
            {demo ? (
              <p className="text-[13px] text-muted">You already have a demo business. Switch to it from the business menu.</p>
            ) : (
              <ActionForm action={createDemo}>
                <SubmitButton variant="secondary" pendingLabel="Creating…">
                  Open a demo business
                </SubmitButton>
              </ActionForm>
            )}
          </div>
          <StepButtons step="import" />
        </>
      );
    }
    case "app":
      return (
        <>
          <p className="mb-4 text-[14px]">SCALER works in the browser and installs like an app, with reminders as phone notifications.</p>
          <InstallAppButton />
          <StepButtons step="app" continueLabel="Done" />
        </>
      );
  }
}

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const ctx = await getContext();
  if (!can(ctx, "settings.business.manage")) return <NoAccess what="setup" />;
  const status = await getOnboarding(ctx.business.businessId);
  const sp = await searchParams;
  const asked = Array.isArray(sp.step) ? sp.step[0] : sp.step;
  if (asked && !isStep(asked)) redirect("/setup");
  const current = isStep(asked) ? asked : nextStep(status);
  const { done, total } = progress(status);

  if (!current) {
    return (
      <>
        <PageHeader title="You're set up" description={`${done} of ${total} steps done. Skipped steps are always here and in Settings.`} />
        <Panel className="p-5">
          <ul className="mb-5 space-y-1.5 text-[14px]">
            {STEPS.map((s) => (
              <li key={s.key}>
                <Link href={`/setup?step=${s.key}`} className="hover:text-signal">
                  {status.steps[s.key] && !status.skipped[s.key] ? "✓" : "–"} {s.title}
                  {status.skipped[s.key] && <span className="text-muted"> (skipped)</span>}
                </Link>
              </li>
            ))}
          </ul>
          {status.completedAt ? (
            <Link href="/dashboard" className={linkButton.primary}>
              Go to the dashboard
            </Link>
          ) : (
            <ActionForm action={finishSetup}>
              <SubmitButton pendingLabel="Finishing…">Start using SCALER</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      </>
    );
  }
  const index = STEPS.findIndex((s) => s.key === current);
  const step = STEPS[index]!;

  return (
    <>
      <PageHeader
        title="Set up SCALER"
        description={`Step ${index + 1} of ${total}. Everything here can be changed later; skip anything that can wait.`}
      />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Setup steps">
          <ol className="space-y-1 text-[13.5px]">
            {STEPS.map((s, i) => {
              const finished = status.steps[s.key] && !status.skipped[s.key];
              return (
                <li key={s.key}>
                  <Link
                    href={`/setup?step=${s.key}`}
                    aria-current={s.key === current ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 hover:bg-paper",
                      s.key === current && "bg-surface font-medium shadow-[inset_0_0_0_1px_var(--color-line)]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border text-[11px]",
                        finished ? "border-stage-won bg-stage-won text-white" : "border-line text-muted",
                      )}
                    >
                      {finished ? <Check className="size-3" /> : i + 1}
                    </span>
                    {s.short}
                    {status.skipped[s.key] && <span className="text-[12px] text-muted">skipped</span>}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <Panel className="p-5">
          <h2 className="text-[17px] font-semibold">{step.title}</h2>
          <p className="mb-5 text-[13.5px] text-muted">{step.description}</p>
          <StepBody step={current} businessId={ctx.business.businessId} />
        </Panel>
      </div>
    </>
  );
}
