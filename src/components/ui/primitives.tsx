import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[65ch] text-[14px] text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-panel)] border border-line bg-surface",
        className,
      )}
      {...props}
    />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-[13.5px] font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-signal text-white hover:bg-signal-strong",
        variant === "secondary" && "border border-line bg-surface hover:bg-paper",
        variant === "ghost" && "text-muted hover:bg-paper hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

const stageClass = {
  new: "bg-stage-new",
  contacted: "bg-stage-contacted",
  qualified: "bg-stage-qualified",
  negotiation: "bg-stage-negotiation",
  won: "bg-stage-won",
  lost: "bg-stage-lost",
} as const;

export type Stage = keyof typeof stageClass;

export function StageDot({ stage }: { stage: Stage }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", stageClass[stage])} />;
}

export function StatusBadge({ stage, name }: { stage: Stage; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[12px] font-medium whitespace-nowrap">
      <StageDot stage={stage} />
      {name}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-[14.5px] font-medium">{title}</p>
      {children && <div className="mt-1 text-[13.5px] text-muted">{children}</div>}
    </div>
  );
}

/** Link styled like a button, for navigation actions in page headers. */
export const linkButton = {
  primary:
    "inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] bg-signal px-3.5 text-[13.5px] font-medium text-white hover:bg-signal-strong",
  secondary:
    "inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium hover:bg-paper",
};
