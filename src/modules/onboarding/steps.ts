/** The setup wizard's steps, in order. Under 10, each resumable and skippable. */

export const STEPS = [
  { key: "profile", title: "Business details", short: "Your business", description: "Name, legal name and time zone, as customers and invoices see them." },
  { key: "template", title: "Your industry", short: "Industry", description: "Pipeline stages, sources, lost reasons, order stages, fields and starter automations made for your trade." },
  { key: "branches", title: "Branches", short: "Branches", description: "Every store, studio or office that handles customers." },
  { key: "team", title: "Invite your team", short: "Team", description: "Each person gets a role that decides what they can see and do." },
  { key: "whatsapp", title: "Connect WhatsApp", short: "WhatsApp", description: "Reply to customers and send reminders from your own WhatsApp Business number." },
  { key: "import", title: "Bring in your customers", short: "Customers", description: "Import a spreadsheet of customers and leads, or try SCALER with sample data first." },
  { key: "app", title: "Install the app", short: "App", description: "Put SCALER on your team's phones' home screens, with notifications." },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export type OnboardingStatus = {
  steps: Record<StepKey, boolean>;
  skipped: Partial<Record<StepKey, boolean>>;
  templateKey: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  isDemo: boolean;
};

export function isStep(v: unknown): v is StepKey {
  return typeof v === "string" && STEPS.some((s) => s.key === v);
}

/** The first step neither done nor skipped, or null when there's nothing left. */
export function nextStep(status: OnboardingStatus): StepKey | null {
  return STEPS.find((s) => !status.steps[s.key] && !status.skipped[s.key])?.key ?? null;
}

export function progress(status: OnboardingStatus) {
  const done = STEPS.filter((s) => status.steps[s.key] && !status.skipped[s.key]).length;
  return { done, total: STEPS.length };
}

/** The dashboard checklist shows until setup is finished or hidden, and never in a demo. */
export function showChecklist(status: OnboardingStatus) {
  return !status.isDemo && !status.dismissedAt && (!status.completedAt || progress(status).done < STEPS.length);
}
